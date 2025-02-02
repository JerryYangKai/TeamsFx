// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Platform, ProjectSettings, TokenProvider, v2, v3 } from "@microsoft/teamsfx-api";
import { assert } from "chai";
import "mocha";
import * as uuid from "uuid";
import {
  BuiltInSolutionNames,
  TeamsFxAzureSolutionNameV3,
} from "../../../src/plugins/solution/fx-solution/v3/constants";
import { getQuestionsForUserTask } from "../../../src/plugins/solution/fx-solution/v3/userTask";
import {
  MockedAppStudioTokenProvider,
  MockedAzureAccountProvider,
  MockedGraphTokenProvider,
  MockedSharepointProvider,
  MockedV2Context,
} from "../solution/util";
import * as path from "path";
import * as os from "os";
import { randomAppName } from "../../core/utils";
import { Container } from "typedi";
describe("SolutionV3 - executeUserTask", () => {
  const solution = Container.get<v3.ISolution>(BuiltInSolutionNames.azure);
  it("executeUserTask", async () => {
    const projectSettings: ProjectSettings = {
      appName: "my app",
      projectId: uuid.v4(),
      solutionSettings: {
        name: TeamsFxAzureSolutionNameV3,
      },
    };
    const ctx = new MockedV2Context(projectSettings);
    const inputs: v2.InputsWithProjectPath = {
      platform: Platform.VSCode,
      projectPath: path.join(os.tmpdir(), randomAppName()),
    };
    const mockedTokenProvider: TokenProvider = {
      azureAccountProvider: new MockedAzureAccountProvider(),
      appStudioToken: new MockedAppStudioTokenProvider(),
      graphTokenProvider: new MockedGraphTokenProvider(),
      sharepointTokenProvider: new MockedSharepointProvider(),
    };
    const envInfoV3: v3.EnvInfoV3 = {
      envName: "dev",
      state: { solution: {} },
      config: {},
    };
    const res = await solution.executeUserTask!(
      ctx,
      inputs,
      { namespace: "", method: "addCapability" },
      envInfoV3,
      mockedTokenProvider
    );
    assert.isTrue(res.isErr());
  });

  it("getQuestionsForAddResource", async () => {
    const projectSettings: ProjectSettings = {
      appName: "my app",
      projectId: uuid.v4(),
      solutionSettings: {
        name: TeamsFxAzureSolutionNameV3,
        version: "3.0.0",
        capabilities: [],
        hostType: "Azure",
        azureResources: [],
        activeResourcePlugins: [],
      },
    };
    const ctx = new MockedV2Context(projectSettings);
    const inputs: v2.InputsWithProjectPath = {
      platform: Platform.VSCode,
      projectPath: path.join(os.tmpdir(), randomAppName()),
    };
    const mockedTokenProvider: TokenProvider = {
      azureAccountProvider: new MockedAzureAccountProvider(),
      appStudioToken: new MockedAppStudioTokenProvider(),
      graphTokenProvider: new MockedGraphTokenProvider(),
      sharepointTokenProvider: new MockedSharepointProvider(),
    };
    const res = await getQuestionsForUserTask(
      ctx,
      inputs,
      { namespace: "", method: "addResource" },
      { envName: "dev", config: {}, state: { solution: {} } },
      mockedTokenProvider
    );
    assert.isTrue(res.isOk());
  });
});
