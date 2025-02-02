// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * @author Ivan He <ruhe@microsoft.com>
 */

import path from "path";
import fs from "fs-extra";
import * as chai from "chai";

import {
  getSubscriptionId,
  getTestFolder,
  getUniqueAppName,
  cleanUp,
  setBotSkuNameToB1Bicep,
} from "../commonUtils";
import { environmentManager } from "@microsoft/teamsfx-core";
import { CliHelper } from "../../commonlib/cliHelper";
import { Capability, ResourceToDeploy } from "../../commonlib/constants";
import { ErrorType, PluginError } from "../../../../fx-core/src/plugins/resource/bot/errors";

describe("Error type should be expected", function () {
  const testFolder = getTestFolder();
  const subscription = getSubscriptionId();
  const appName = getUniqueAppName();
  const projectPath = path.resolve(testFolder, appName);
  const env = environmentManager.getDefaultEnvName();

  after(async () => {
    await cleanUp(appName, projectPath, true, true, false, true);
  });

  it(`CommandExecutionError should be in UserError`, async function () {
    // Create new bot project
    await CliHelper.createProjectWithCapability(appName, testFolder, Capability.Bot);

    // Provision
    await setBotSkuNameToB1Bicep(projectPath, env);
    await CliHelper.setSubscription(subscription, projectPath);
    await CliHelper.provisionProject(projectPath);

    // Make CommandExecutionError
    // Make `package.json` invalid, so CommandExecutionError would occur when running `npm install`.
    const packageJsonPath = path.join(projectPath, "bot", "package.json");
    if (!(await fs.pathExists(packageJsonPath))) {
      chai.assert.fail(`${packageJsonPath} is not found.`);
    }
    await fs.writeFile(packageJsonPath, "any invalid json");
    // deploy
    try {
      await CliHelper.deployProject(ResourceToDeploy.Bot, projectPath);
    } catch (e) {
      chai.assert.isTrue(e instanceof PluginError);
      chai.assert.isTrue(e.ErrorType == ErrorType.User);
      return;
    }

    // Assert
    chai.assert.fail("Should not reach here!!!");
  });
});
