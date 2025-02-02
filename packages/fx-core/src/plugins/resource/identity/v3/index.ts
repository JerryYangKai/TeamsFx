// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { hooks } from "@feathersjs/hooks/lib";
import { AzureSolutionSettings, err, FxError, ok, Result, v2, v3 } from "@microsoft/teamsfx-api";
import * as path from "path";
import { Service } from "typedi";
import { ArmTemplateResult } from "../../../../common/armInterface";
import { Bicep } from "../../../../common/constants";
import { generateBicepFromFile } from "../../../../common/tools";
import { CommonErrorHandlerMW } from "../../../../core/middleware/CommonErrorHandlerMW";
import { getTemplatesFolder } from "../../../../folder";
import { BuiltInFeaturePluginNames } from "../../../solution/fx-solution/v3/constants";
import { IdentityConfig } from "../config";
import { IdentityBicep, IdentityBicepFile } from "../constants";

@Service(BuiltInFeaturePluginNames.identity)
export class IdentityPluginV3 implements v3.FeaturePlugin {
  name = BuiltInFeaturePluginNames.identity;
  displayName = "Microsoft Identity";
  description = "Microsoft Identity";
  config: IdentityConfig = new IdentityConfig();
  @hooks([CommonErrorHandlerMW({ telemetry: { component: BuiltInFeaturePluginNames.identity } })])
  async generateResourceTemplate(
    ctx: v3.ContextWithManifestProvider,
    inputs: v3.AddFeatureInputs
  ): Promise<Result<v2.ResourceTemplate[], FxError>> {
    const pluginCtx = { plugins: inputs.allPluginsAfterAdd };
    const bicepTemplateDirectory = path.join(
      getTemplatesFolder(),
      "plugins",
      "resource",
      "identity",
      "bicep"
    );
    const provisionOrchestration = await generateBicepFromFile(
      path.join(bicepTemplateDirectory, Bicep.ProvisionFileName),
      pluginCtx
    );
    const provisionModules = await generateBicepFromFile(
      path.join(bicepTemplateDirectory, IdentityBicepFile.moduleTempalteFilename),
      pluginCtx
    );
    const result: ArmTemplateResult = {
      Provision: {
        Orchestration: provisionOrchestration,
        Modules: { identity: provisionModules },
      },
      Reference: {
        identityName: IdentityBicep.identityName,
        identityClientId: IdentityBicep.identityClientId,
        identityResourceId: IdentityBicep.identityResourceId,
        identityPrincipalId: IdentityBicep.identityPrincipalId,
      },
    };
    return ok([{ kind: "bicep", template: result }]);
  }
  @hooks([CommonErrorHandlerMW({ telemetry: { component: BuiltInFeaturePluginNames.identity } })])
  async addFeature(
    ctx: v3.ContextWithManifestProvider,
    inputs: v3.AddFeatureInputs
  ): Promise<Result<v2.ResourceTemplate[], FxError>> {
    const armRes = await this.generateResourceTemplate(ctx, inputs);
    if (armRes.isErr()) return err(armRes.error);
    const solutionSettings = ctx.projectSetting.solutionSettings as AzureSolutionSettings;
    const activeResourcePlugins = solutionSettings.activeResourcePlugins;
    if (!activeResourcePlugins.includes(this.name)) activeResourcePlugins.push(this.name);
    return ok(armRes.value);
  }
  @hooks([CommonErrorHandlerMW({ telemetry: { component: BuiltInFeaturePluginNames.identity } })])
  async afterOtherFeaturesAdded(
    ctx: v3.ContextWithManifestProvider,
    inputs: v3.OtherFeaturesAddedInputs
  ): Promise<Result<v2.ResourceTemplate[], FxError>> {
    const result: ArmTemplateResult = {
      Reference: {
        identityName: IdentityBicep.identityName,
        identityClientId: IdentityBicep.identityClientId,
        identityResourceId: IdentityBicep.identityResourceId,
        identityPrincipalId: IdentityBicep.identityPrincipalId,
      },
    };
    return ok([{ kind: "bicep", template: result }]);
  }
}
