namespace ts.projectSystem {
    describe("tsserverProjectSystem with project references and tsbuild", () => {
        function createHost(files: ReadonlyArray<File>, rootNames: ReadonlyArray<string>) {
            const host = createServerHost(files);

            // ts build should succeed
            const solutionBuilder = tscWatch.createSolutionBuilder(host, rootNames, {});
            solutionBuilder.buildAllProjects();
            assert.equal(host.getOutput().length, 0);

            return host;
        }

        describe("with container project", () => {
            function getProjectFiles(project: string): [File, File] {
                return [
                    TestFSWithWatch.getTsBuildProjectFile(project, "tsconfig.json"),
                    TestFSWithWatch.getTsBuildProjectFile(project, "index.ts"),
                ];
            }

            const project = "container";
            const containerLib = getProjectFiles("container/lib");
            const containerExec = getProjectFiles("container/exec");
            const containerCompositeExec = getProjectFiles("container/compositeExec");
            const containerConfig = TestFSWithWatch.getTsBuildProjectFile(project, "tsconfig.json");
            const files = [libFile, ...containerLib, ...containerExec, ...containerCompositeExec, containerConfig];

            it("does not error on container only project", () => {
                const host = createHost(files, [containerConfig.path]);

                // Open external project for the folder
                const session = createSession(host);
                const service = session.getProjectService();
                service.openExternalProjects([{
                    projectFileName: TestFSWithWatch.getTsBuildProjectFilePath(project, project),
                    rootFiles: files.map(f => ({ fileName: f.path })),
                    options: {}
                }]);
                checkNumberOfProjects(service, { configuredProjects: 4 });
                files.forEach(f => {
                    const args: protocol.FileRequestArgs = {
                        file: f.path,
                        projectFileName: endsWith(f.path, "tsconfig.json") ? f.path : undefined
                    };
                    const syntaxDiagnostics = session.executeCommandSeq<protocol.SyntacticDiagnosticsSyncRequest>({
                        command: protocol.CommandTypes.SyntacticDiagnosticsSync,
                        arguments: args
                    }).response;
                    assert.deepEqual(syntaxDiagnostics, []);
                    const semanticDiagnostics = session.executeCommandSeq<protocol.SemanticDiagnosticsSyncRequest>({
                        command: protocol.CommandTypes.SemanticDiagnosticsSync,
                        arguments: args
                    }).response;
                    assert.deepEqual(semanticDiagnostics, []);
                });
                const containerProject = service.configuredProjects.get(containerConfig.path)!;
                checkProjectActualFiles(containerProject, [containerConfig.path]);
                const optionsDiagnostics = session.executeCommandSeq<protocol.CompilerOptionsDiagnosticsRequest>({
                    command: protocol.CommandTypes.CompilerOptionsDiagnosticsFull,
                    arguments: { projectFileName: containerProject.projectName }
                }).response;
                assert.deepEqual(optionsDiagnostics, []);
            });

            it("can successfully find references with --out options", () => {
                const host = createHost(files, [containerConfig.path]);
                const session = createSession(host);
                openFilesForSession([containerCompositeExec[1]], session);
                const service = session.getProjectService();
                checkNumberOfProjects(service, { configuredProjects: 1 });
                const locationOfMyConst = protocolLocationFromSubstring(containerCompositeExec[1].content, "myConst");
                const response = session.executeCommandSeq<protocol.RenameRequest>({
                    command: protocol.CommandTypes.Rename,
                    arguments: {
                        file: containerCompositeExec[1].path,
                        ...locationOfMyConst
                    }
                }).response as protocol.RenameResponseBody;


                const myConstLen = "myConst".length;
                const locationOfMyConstInLib = protocolLocationFromSubstring(containerLib[1].content, "myConst");
                assert.deepEqual(response.locs, [
                    { file: containerCompositeExec[1].path, locs: [{ start: locationOfMyConst, end: { line: locationOfMyConst.line, offset: locationOfMyConst.offset + myConstLen } }] },
                    { file: containerLib[1].path, locs: [{ start: locationOfMyConstInLib, end: { line: locationOfMyConstInLib.line, offset: locationOfMyConstInLib.offset + myConstLen } }] }
                ]);
            });
        });

        it("can go to definition correctly", () => {
            const projectLocation = "/user/username/projects/myproject";
            const dependecyLocation = `${projectLocation}/dependency`;
            const mainLocation = `${projectLocation}/main`;
            const dependencyTs: File = {
                path: `${dependecyLocation}/FnS.ts`,
                content: `export function fn1() { }
export function fn2() { }
export function fn3() { }
export function fn4() { }
export function fn5() { }`
            };
            const dependencyConfig: File = {
                path: `${dependecyLocation}/tsconfig.json`,
                content: JSON.stringify({ compilerOptions: { composite: true, declarationMap: true } })
            };

            const mainTs: File = {
                path: `${mainLocation}/main.ts`,
                content: `import {
    fn1, fn2, fn3, fn4, fn5
} from '../dependency/fns'

fn1();
fn2();
fn3();
fn4();
fn5();`
            };
            const mainConfig: File = {
                path: `${mainLocation}/tsconfig.json`,
                content: JSON.stringify({
                    compilerOptions: { composite: true, declarationMap: true },
                    references: [{ path: "../dependency" }]
                })
            };

            const files = [dependencyTs, dependencyConfig, mainTs, mainConfig, libFile];
            const host = createHost(files, [mainConfig.path]);
            const session = createSession(host);
            const service = session.getProjectService();
            openFilesForSession([mainTs], session);
            checkNumberOfProjects(service, { configuredProjects: 1 });
            checkProjectActualFiles(service.configuredProjects.get(mainConfig.path)!, [mainTs.path, libFile.path, mainConfig.path, `${dependecyLocation}/fns.d.ts`]);
            for (let i = 0; i < 5; i++) {
                const startSpan = { line: i + 5, offset: 1 };
                const response = session.executeCommandSeq<protocol.DefinitionAndBoundSpanRequest>({
                    command: protocol.CommandTypes.DefinitionAndBoundSpan,
                    arguments: { file: mainTs.path, ...startSpan }
                }).response as protocol.DefinitionInfoAndBoundSpan;
                assert.deepEqual(response, {
                    definitions: [{ file: dependencyTs.path, start: { line: i + 1, offset: 17 }, end: { line: i + 1, offset: 20 } }],
                    textSpan: { start: startSpan, end: { line: startSpan.line, offset: startSpan.offset + 3 } }
                });
            }
        });
    });
}
