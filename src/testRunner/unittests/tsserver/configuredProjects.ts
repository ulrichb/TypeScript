namespace ts.projectSystem {
    describe("tsserverProjectSystem general functionality", () => {
        it("create configured project with the file list", () => {
            const configFile: File = {
                path: "/a/b/tsconfig.json",
                content: `
                {
                    "compilerOptions": {},
                    "include": ["*.ts"]
                }`
            };
            const file1: File = {
                path: "/a/b/f1.ts",
                content: "let x = 1"
            };
            const file2: File = {
                path: "/a/b/f2.ts",
                content: "let y = 1"
            };
            const file3: File = {
                path: "/a/b/c/f3.ts",
                content: "let z = 1"
            };

            const host = createServerHost([configFile, libFile, file1, file2, file3]);
            const projectService = createProjectService(host);
            const { configFileName, configFileErrors } = projectService.openClientFile(file1.path);

            assert(configFileName, "should find config file");
            assert.isTrue(!configFileErrors || configFileErrors.length === 0, `expect no errors in config file, got ${JSON.stringify(configFileErrors)}`);
            checkNumberOfInferredProjects(projectService, 0);
            checkNumberOfConfiguredProjects(projectService, 1);

            const project = configuredProjectAt(projectService, 0);
            checkProjectActualFiles(project, [file1.path, libFile.path, file2.path, configFile.path]);
            checkProjectRootFiles(project, [file1.path, file2.path]);
            // watching all files except one that was open
            checkWatchedFiles(host, [configFile.path, file2.path, libFile.path]);
            checkWatchedDirectories(host, [getDirectoryPath(configFile.path)], /*recursive*/ false);
        });
    });

    describe("tsserverProjectSystem non-existing directories listed in config file input array", () => {
        it("should be tolerated without crashing the server", () => {
            const configFile = {
                path: "/a/b/tsconfig.json",
                content: `{
                    "compilerOptions": {},
                    "include": ["app/*", "test/**/*", "something"]
                }`
            };
            const file1 = {
                path: "/a/b/file1.ts",
                content: "let t = 10;"
            };

            const host = createServerHost([file1, configFile]);
            const projectService = createProjectService(host);
            projectService.openClientFile(file1.path);
            host.runQueuedTimeoutCallbacks();
            // Since there is no file open from configFile it would be closed
            checkNumberOfConfiguredProjects(projectService, 0);
            checkNumberOfInferredProjects(projectService, 1);

            const inferredProject = projectService.inferredProjects[0];
            assert.isTrue(inferredProject.containsFile(<server.NormalizedPath>file1.path));
        });

        it("should be able to handle @types if input file list is empty", () => {
            const f = {
                path: "/a/app.ts",
                content: "let x = 1"
            };
            const config = {
                path: "/a/tsconfig.json",
                content: JSON.stringify({
                    compiler: {},
                    files: []
                })
            };
            const t1 = {
                path: "/a/node_modules/@types/typings/index.d.ts",
                content: `export * from "./lib"`
            };
            const t2 = {
                path: "/a/node_modules/@types/typings/lib.d.ts",
                content: `export const x: number`
            };
            const host = createServerHost([f, config, t1, t2], { currentDirectory: getDirectoryPath(f.path) });
            const projectService = createProjectService(host);

            projectService.openClientFile(f.path);
            // Since no file from the configured project is open, it would be closed immediately
            projectService.checkNumberOfProjects({ configuredProjects: 0, inferredProjects: 1 });
        });

        it("should tolerate invalid include files that start in subDirectory", () => {
            const projectFolder = "/user/username/projects/myproject";
            const f = {
                path: `${projectFolder}/src/server/index.ts`,
                content: "let x = 1"
            };
            const config = {
                path: `${projectFolder}/src/server/tsconfig.json`,
                content: JSON.stringify({
                    compiler: {
                        module: "commonjs",
                        outDir: "../../build"
                    },
                    include: [
                        "../src/**/*.ts"
                    ]
                })
            };
            const host = createServerHost([f, config, libFile], { useCaseSensitiveFileNames: true });
            const projectService = createProjectService(host);

            projectService.openClientFile(f.path);
            // Since no file from the configured project is open, it would be closed immediately
            projectService.checkNumberOfProjects({ configuredProjects: 0, inferredProjects: 1 });
        });
    });
}
