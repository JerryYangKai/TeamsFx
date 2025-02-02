// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { IProgressHandler, UserInteraction } from "@microsoft/teamsfx-api";
import { ProgressTitleMessage, PreDeployProgressMessage, DeployProgressMessage } from "./constants";

export class ProgressHelper {
  static preDeployProgress: IProgressHandler | undefined;
  static deployProgress: IProgressHandler | undefined;

  static async startPreDeployProgressHandler(
    ui: UserInteraction | undefined
  ): Promise<IProgressHandler | undefined> {
    this.preDeployProgress = ui?.createProgressBar(
      ProgressTitleMessage.PreDeployProgressTitle,
      Object.entries(PreDeployProgressMessage).length
    );
    await this.preDeployProgress?.start("");
    return this.preDeployProgress;
  }

  static async endAllHandlers(success: boolean): Promise<void> {
    await this.endPreDeployProgress(success);
  }

  static async endPreDeployProgress(success: boolean): Promise<void> {
    await this.preDeployProgress?.end(success);
    this.preDeployProgress = undefined;
  }

  static async startDeployProgressHandler(
    ui: UserInteraction | undefined
  ): Promise<IProgressHandler | undefined> {
    this.deployProgress = ui?.createProgressBar(
      ProgressTitleMessage.DeployProgressTitle,
      Object.entries(DeployProgressMessage).length
    );
    await this.deployProgress?.start("");
    return this.deployProgress;
  }

  static async endDeployProgress(success: boolean): Promise<void> {
    await this.deployProgress?.end(success);
    this.deployProgress = undefined;
  }
}
