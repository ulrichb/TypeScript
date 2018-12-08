namespace ts.projectSystem {
    describe("tsserverProjectSystem general functionality", () => {
        describe("can handle tsconfig file name with difference casing", () => {
            function verifyConfigFileCasing(lazyConfiguredProjectsFromExternalProject: boolean) {
                const f1 = {
                    path: "/a/b/app.ts",
                    content: "let x = 1"
                };
                const config = {
                    path: "/a/b/tsconfig.json",
                    content: JSON.stringify({
                        include: []
                    })
                };

                const host = createServerHost([f1, config], { useCaseSensitiveFileNames: false });
                const service = createProjectService(host);
                service.setHostConfiguration({ preferences: { lazyConfiguredProjectsFromExternalProject } });
                const upperCaseConfigFilePath = combinePaths(getDirectoryPath(config.path).toUpperCase(), getBaseFileName(config.path));
                service.openExternalProject(<protocol.ExternalProject>{
                    projectFileName: "/a/b/project.csproj",
                    rootFiles: toExternalFiles([f1.path, upperCaseConfigFilePath]),
                    options: {}
                });
                service.checkNumberOfProjects({ configuredProjects: 1 });
                const project = service.configuredProjects.get(config.path)!;
                if (lazyConfiguredProjectsFromExternalProject) {
                    assert.equal(project.pendingReload, ConfigFileProgramReloadLevel.Full); // External project referenced configured project pending to be reloaded
                    checkProjectActualFiles(project, emptyArray);
                }
                else {
                    assert.equal(project.pendingReload, ConfigFileProgramReloadLevel.None); // External project referenced configured project loaded
                    checkProjectActualFiles(project, [upperCaseConfigFilePath]);
                }

                service.openClientFile(f1.path);
                service.checkNumberOfProjects({ configuredProjects: 1, inferredProjects: 1 });

                assert.equal(project.pendingReload, ConfigFileProgramReloadLevel.None); // External project referenced configured project is updated
                checkProjectActualFiles(project, [upperCaseConfigFilePath]);
                checkProjectActualFiles(service.inferredProjects[0], [f1.path]);
            }

            it("when lazyConfiguredProjectsFromExternalProject not set", () => {
                verifyConfigFileCasing(/*lazyConfiguredProjectsFromExternalProject*/ false);
            });

            it("when lazyConfiguredProjectsFromExternalProject is set", () => {
                verifyConfigFileCasing(/*lazyConfiguredProjectsFromExternalProject*/ true);
            });
        });


        it("create configured project without file list", () => {
            const configFile: File = {
                path: "/a/b/tsconfig.json",
                content: `
                {
                    "compilerOptions": {},
                    "exclude": [
                        "e"
                    ]
                }`
            };
            const file1: File = {
                path: "/a/b/c/f1.ts",
                content: "let x = 1"
            };
            const file2: File = {
                path: "/a/b/d/f2.ts",
                content: "let y = 1"
            };
            const file3: File = {
                path: "/a/b/e/f3.ts",
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
            const configFileDirectory = getDirectoryPath(configFile.path);
            checkWatchedDirectories(host, [configFileDirectory, combinePaths(configFileDirectory, nodeModulesAtTypes)], /*recursive*/ true);
        });
    });

    it("add and then remove a config file in a folder with loose files", () => {
        const configFile: File = {
            path: "/a/b/tsconfig.json",
            content: `{
                    "files": ["commonFile1.ts"]
                }`
        };
        const filesWithoutConfig = [libFile, commonFile1, commonFile2];
        const host = createServerHost(filesWithoutConfig);

        const filesWithConfig = [libFile, commonFile1, commonFile2, configFile];
        const projectService = createProjectService(host);
        projectService.openClientFile(commonFile1.path);
        projectService.openClientFile(commonFile2.path);

        projectService.checkNumberOfProjects({ inferredProjects: 2 });
        checkProjectActualFiles(projectService.inferredProjects[0], [commonFile1.path, libFile.path]);
        checkProjectActualFiles(projectService.inferredProjects[1], [commonFile2.path, libFile.path]);

        const configFileLocations = ["/", "/a/", "/a/b/"];
        const watchedFiles = flatMap(configFileLocations, location => [location + "tsconfig.json", location + "jsconfig.json"]).concat(libFile.path);
        checkWatchedFiles(host, watchedFiles);

        // Add a tsconfig file
        host.reloadFS(filesWithConfig);
        host.checkTimeoutQueueLengthAndRun(2); // load configured project from disk + ensureProjectsForOpenFiles

        projectService.checkNumberOfProjects({ inferredProjects: 2, configuredProjects: 1 });
        assert.isTrue(projectService.inferredProjects[0].isOrphan());
        checkProjectActualFiles(projectService.inferredProjects[1], [commonFile2.path, libFile.path]);
        checkProjectActualFiles(projectService.configuredProjects.get(configFile.path)!, [libFile.path, commonFile1.path, configFile.path]);

        checkWatchedFiles(host, watchedFiles);

        // remove the tsconfig file
        host.reloadFS(filesWithoutConfig);

        projectService.checkNumberOfProjects({ inferredProjects: 2 });
        assert.isTrue(projectService.inferredProjects[0].isOrphan());
        checkProjectActualFiles(projectService.inferredProjects[1], [commonFile2.path, libFile.path]);

        host.checkTimeoutQueueLengthAndRun(1); // Refresh inferred projects

        projectService.checkNumberOfProjects({ inferredProjects: 2 });
        checkProjectActualFiles(projectService.inferredProjects[0], [commonFile1.path, libFile.path]);
        checkProjectActualFiles(projectService.inferredProjects[1], [commonFile2.path, libFile.path]);
        checkWatchedFiles(host, watchedFiles);
    });
}
