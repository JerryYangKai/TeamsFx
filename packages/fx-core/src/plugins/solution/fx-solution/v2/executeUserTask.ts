import {
  v2,
  Inputs,
  FxError,
  Result,
  ok,
  err,
  returnUserError,
  Func,
  returnSystemError,
  TelemetryReporter,
  AzureSolutionSettings,
  Void,
  Platform,
  UserInteraction,
  SolutionSettings,
  TokenProvider,
  combine,
  Json,
  UserError,
  IStaticTab,
  IConfigurableTab,
  IBot,
  IComposeExtension,
} from "@microsoft/teamsfx-api";
import { getStrings, isArmSupportEnabled } from "../../../../common/tools";
import { getAzureSolutionSettings, reloadV2Plugins } from "./utils";
import {
  SolutionError,
  SolutionTelemetryComponentName,
  SolutionTelemetryEvent,
  SolutionTelemetryProperty,
  SolutionTelemetrySuccess,
  SolutionSource,
} from "../constants";
import * as util from "util";
import {
  AzureResourceApim,
  AzureResourceFunction,
  AzureResourceKeyVault,
  AzureResourceSQL,
  AzureSolutionQuestionNames,
  BotOptionItem,
  HostTypeOptionAzure,
  MessageExtensionItem,
  TabOptionItem,
} from "../question";
import { cloneDeep } from "lodash";
import { sendErrorTelemetryThenReturnError } from "../utils/util";
import { getAllV2ResourcePluginMap, ResourcePluginsV2 } from "../ResourcePluginContainer";
import { Container } from "typedi";
import { scaffoldByPlugins } from "./scaffolding";
import { generateResourceTemplateForPlugins } from "./generateResourceTemplate";
import { scaffoldLocalDebugSettings } from "../debug/scaffolding";
import { AppStudioPluginV3 } from "../../../resource/appstudio/v3";
import { BuiltInResourcePluginNames } from "../v3/constants";
export async function executeUserTask(
  ctx: v2.Context,
  inputs: Inputs,
  func: Func,
  localSettings: Json,
  envInfo: v2.EnvInfoV2,
  tokenProvider: TokenProvider
): Promise<Result<unknown, FxError>> {
  const namespace = func.namespace;
  const method = func.method;
  const array = namespace.split("/");
  if (method === "addCapability") {
    return addCapability(ctx, inputs, localSettings);
  }
  if (method === "addResource") {
    return addResource(ctx, inputs, localSettings, func, envInfo, tokenProvider);
  }
  if (namespace.includes("solution")) {
    if (method === "registerTeamsAppAndAad") {
      // not implemented for now
      return err(
        returnSystemError(
          new Error("Not implemented"),
          SolutionSource,
          SolutionError.FeatureNotSupported
        )
      );
    } else if (method === "VSpublish") {
      // VSpublish means VS calling cli to do publish. It is different than normal cli work flow
      // It's teamsfx init followed by teamsfx  publish without running provision.
      // Using executeUserTask here could bypass the fx project check.
      if (inputs.platform !== "vs") {
        return err(
          returnSystemError(
            new Error(`VS publish is not supposed to run on platform ${inputs.platform}`),
            SolutionSource,
            SolutionError.UnsupportedPlatform
          )
        );
      }
      const appStudioPlugin = Container.get<v2.ResourcePlugin>(ResourcePluginsV2.AppStudioPlugin);
      if (appStudioPlugin.publishApplication) {
        return appStudioPlugin.publishApplication(
          ctx,
          inputs,
          envInfo,
          tokenProvider.appStudioToken
        );
      }
    } else if (method === "validateManifest") {
      const appStudioPlugin = Container.get<v2.ResourcePlugin>(ResourcePluginsV2.AppStudioPlugin);
      if (appStudioPlugin.executeUserTask) {
        return await appStudioPlugin.executeUserTask(
          ctx,
          inputs,
          func,
          localSettings,
          envInfo,
          tokenProvider
        );
      }
    } else if (method === "buildPackage") {
      const appStudioPlugin = Container.get<v2.ResourcePlugin>(ResourcePluginsV2.AppStudioPlugin);
      if (appStudioPlugin.executeUserTask) {
        return await appStudioPlugin.executeUserTask(
          ctx,
          inputs,
          func,
          localSettings,
          envInfo,
          tokenProvider
        );
      }
    } else if (method === "validateManifest") {
      const appStudioPlugin = Container.get<v2.ResourcePlugin>(ResourcePluginsV2.AppStudioPlugin);
      if (appStudioPlugin.executeUserTask) {
        return appStudioPlugin.executeUserTask(
          ctx,
          inputs,
          func,
          localSettings,
          envInfo,
          tokenProvider
        );
      }
    } else if (array.length == 2) {
      const pluginName = array[1];
      const pluginMap = getAllV2ResourcePluginMap();
      const plugin = pluginMap.get(pluginName);
      if (plugin && plugin.executeUserTask) {
        return plugin.executeUserTask(ctx, inputs, func, localSettings, envInfo, tokenProvider);
      }
    }
  }

  return err(
    returnUserError(
      new Error(`executeUserTaskRouteFailed:${JSON.stringify(func)}`),
      SolutionSource,
      `executeUserTaskRouteFailed`
    )
  );
}

export function canAddCapability(
  settings: AzureSolutionSettings,
  telemetryReporter: TelemetryReporter
): Result<Void, FxError> {
  if (!(settings.hostType === HostTypeOptionAzure.id)) {
    const e = new UserError(
      SolutionError.AddCapabilityNotSupport,
      getStrings().solution.addCapability.OnlySupportAzure,
      SolutionSource
    );
    return err(
      sendErrorTelemetryThenReturnError(SolutionTelemetryEvent.AddCapability, e, telemetryReporter)
    );
  }
  return ok(Void);
}

export function canAddResource(
  settings: AzureSolutionSettings,
  telemetryReporter: TelemetryReporter
): Result<Void, FxError> {
  if (!(settings.hostType === HostTypeOptionAzure.id)) {
    const e = new UserError(
      SolutionError.AddResourceNotSupport,
      getStrings().solution.addResource.OnlySupportAzure,
      SolutionSource
    );
    return err(
      sendErrorTelemetryThenReturnError(SolutionTelemetryEvent.AddResource, e, telemetryReporter)
    );
  }
  return ok(Void);
}

export async function addCapability(
  ctx: v2.Context,
  inputs: Inputs,
  localSettings: Json
): Promise<
  Result<{ solutionSettings?: SolutionSettings; solutionConfig?: Record<string, unknown> }, FxError>
> {
  ctx.telemetryReporter.sendTelemetryEvent(SolutionTelemetryEvent.AddCapabilityStart, {
    [SolutionTelemetryProperty.Component]: SolutionTelemetryComponentName,
  });

  // 1. checking
  const solutionSettings: AzureSolutionSettings = getAzureSolutionSettings(ctx);
  const originalSettings = cloneDeep(solutionSettings);
  const canProceed = canAddCapability(solutionSettings, ctx.telemetryReporter);
  if (canProceed.isErr()) {
    return err(canProceed.error);
  }

  const capabilitiesAnswer = inputs[AzureSolutionQuestionNames.Capabilities] as string[];
  if (!capabilitiesAnswer || capabilitiesAnswer.length === 0) {
    ctx.telemetryReporter?.sendTelemetryEvent(SolutionTelemetryEvent.AddCapability, {
      [SolutionTelemetryProperty.Component]: SolutionTelemetryComponentName,
      [SolutionTelemetryProperty.Success]: SolutionTelemetrySuccess.Yes,
      [SolutionTelemetryProperty.Capabilities]: [].join(";"),
    });
    return ok({});
  }

  solutionSettings.capabilities = solutionSettings.capabilities || [];
  const appStudioPlugin = Container.get<AppStudioPluginV3>(BuiltInResourcePluginNames.appStudio);
  const inputsWithProjectPath = inputs as v2.InputsWithProjectPath;
  const isTabAddable = !(await appStudioPlugin.capabilityExceedLimit(
    ctx,
    inputsWithProjectPath,
    "staticTab"
  ));
  const isBotAddable = !(await appStudioPlugin.capabilityExceedLimit(
    ctx,
    inputsWithProjectPath,
    "Bot"
  ));
  const isMEAddable = !(await appStudioPlugin.capabilityExceedLimit(
    ctx,
    inputsWithProjectPath,
    "MessageExtension"
  ));
  if (
    (capabilitiesAnswer.includes(TabOptionItem.id) && !isTabAddable) ||
    (capabilitiesAnswer.includes(BotOptionItem.id) && !isBotAddable) ||
    (capabilitiesAnswer.includes(MessageExtensionItem.id) && !isMEAddable)
  ) {
    const error = new UserError(
      SolutionError.FailedToAddCapability,
      getStrings().solution.addCapability.ExceedMaxLimit,
      SolutionSource
    );
    return err(
      sendErrorTelemetryThenReturnError(
        SolutionTelemetryEvent.AddCapability,
        error,
        ctx.telemetryReporter
      )
    );
  }

  const capabilitiesToAddManifest: (
    | { name: "staticTab"; snippet?: IStaticTab }
    | { name: "configurableTab"; snippet?: IConfigurableTab }
    | { name: "Bot"; snippet?: IBot }
    | { name: "MessageExtension"; snippet?: IComposeExtension }
  )[] = [];
  const pluginsToScaffoldAndGenerateArm: Set<string> = new Set<string>();
  const newCapabilitySet = new Set<string>();
  solutionSettings.capabilities.forEach((c) => newCapabilitySet.add(c));
  //Tab
  if (capabilitiesAnswer.includes(TabOptionItem.id)) {
    const firstAdd = solutionSettings.capabilities.includes(TabOptionItem.id) ? false : true;
    capabilitiesToAddManifest.push({ name: "staticTab" });
    if (firstAdd) {
      pluginsToScaffoldAndGenerateArm.add(ResourcePluginsV2.FrontendPlugin);
    }
    newCapabilitySet.add(TabOptionItem.id);
  }
  //Bot
  if (capabilitiesAnswer.includes(BotOptionItem.id)) {
    const firstAdd =
      solutionSettings.capabilities.includes(BotOptionItem.id) ||
      solutionSettings.capabilities.includes(MessageExtensionItem.id)
        ? false
        : true;
    capabilitiesToAddManifest.push({ name: "Bot" });
    if (firstAdd) {
      pluginsToScaffoldAndGenerateArm.add(ResourcePluginsV2.BotPlugin);
    }
    newCapabilitySet.add(BotOptionItem.id);
  }
  //MessageExtension
  if (capabilitiesAnswer.includes(MessageExtensionItem.id)) {
    const firstAdd =
      solutionSettings.capabilities.includes(BotOptionItem.id) ||
      solutionSettings.capabilities.includes(MessageExtensionItem.id)
        ? false
        : true;
    capabilitiesToAddManifest.push({ name: "MessageExtension" });
    if (firstAdd) {
      pluginsToScaffoldAndGenerateArm.add(ResourcePluginsV2.BotPlugin);
    }
    newCapabilitySet.add(MessageExtensionItem.id);
  }

  // 2. update solution settings
  solutionSettings.capabilities = Array.from(newCapabilitySet);
  reloadV2Plugins(solutionSettings);

  // 3. scaffold and update arm
  const plugins = Array.from(pluginsToScaffoldAndGenerateArm).map((name) =>
    Container.get<v2.ResourcePlugin>(name)
  );
  if (plugins.length > 0) {
    const pluginNames = plugins.map((p) => p.name).join(",");
    ctx.logProvider?.info(`start scaffolding ${pluginNames}.....`);
    const scaffoldRes = await scaffoldCodeAndResourceTemplate(
      ctx,
      inputs,
      localSettings,
      plugins,
      true,
      plugins
    );
    if (scaffoldRes.isErr()) {
      ctx.logProvider?.info(`failed to scaffold ${pluginNames}!`);
      ctx.projectSetting.solutionSettings = originalSettings;
      return err(
        sendErrorTelemetryThenReturnError(
          SolutionTelemetryEvent.AddCapability,
          scaffoldRes.error,
          ctx.telemetryReporter
        )
      );
    }
    ctx.logProvider?.info(`finish scaffolding ${pluginNames}!`);
    const addNames = capabilitiesAnswer.map((c) => `'${c}'`).join(" and ");
    const single = capabilitiesAnswer.length === 1;
    const template =
      inputs.platform === Platform.CLI
        ? single
          ? getStrings().solution.AddCapabilityNoticeForCli
          : getStrings().solution.AddCapabilitiesNoticeForCli
        : single
        ? getStrings().solution.AddCapabilityNotice
        : getStrings().solution.AddCapabilitiesNotice;
    const msg = util.format(template, addNames);
    ctx.userInteraction.showMessage("info", msg, false);

    ctx.telemetryReporter?.sendTelemetryEvent(SolutionTelemetryEvent.AddCapability, {
      [SolutionTelemetryProperty.Component]: SolutionTelemetryComponentName,
      [SolutionTelemetryProperty.Success]: SolutionTelemetrySuccess.Yes,
      [SolutionTelemetryProperty.Capabilities]: capabilitiesAnswer.join(";"),
    });
  }
  // 4. update manifest
  if (capabilitiesToAddManifest.length > 0) {
    await appStudioPlugin.addCapabilities(ctx, inputsWithProjectPath, capabilitiesToAddManifest);
  }
  return ok({
    solutionSettings: solutionSettings,
    solutionConfig: { provisionSucceeded: false },
  });
}

export function showUpdateArmTemplateNotice(ui?: UserInteraction) {
  const msg: string = util.format(getStrings().solution.UpdateArmTemplateNotice);
  ui?.showMessage("info", msg, false);
}

async function scaffoldCodeAndResourceTemplate(
  ctx: v2.Context,
  inputs: Inputs,
  localSettings: Json,
  pluginsToScaffold: v2.ResourcePlugin[],
  generateTemplate: boolean,
  pluginsToDoArm?: v2.ResourcePlugin[]
): Promise<Result<unknown, FxError>> {
  const result = await scaffoldByPlugins(ctx, inputs, localSettings, pluginsToScaffold);
  if (result.isErr()) {
    return result;
  }
  if (!generateTemplate || !isArmSupportEnabled()) {
    return result;
  }

  const scaffoldLocalDebugSettingsResult = await scaffoldLocalDebugSettings(
    ctx,
    inputs,
    localSettings
  );
  if (scaffoldLocalDebugSettingsResult.isErr()) {
    return scaffoldLocalDebugSettingsResult;
  }

  return generateResourceTemplateForPlugins(
    ctx,
    inputs,
    pluginsToDoArm ? pluginsToDoArm : pluginsToScaffold
  );
}

export async function addResource(
  ctx: v2.Context,
  inputs: Inputs,
  localSettings: Json,
  func: Func,
  envInfo: v2.EnvInfoV2,
  tokenProvider: TokenProvider
): Promise<Result<unknown, FxError>> {
  ctx.telemetryReporter?.sendTelemetryEvent(SolutionTelemetryEvent.AddResourceStart, {
    [SolutionTelemetryProperty.Component]: SolutionTelemetryComponentName,
  });

  const settings: AzureSolutionSettings = getAzureSolutionSettings(ctx);
  const canProceed = canAddResource(settings, ctx.telemetryReporter);
  if (canProceed.isErr()) {
    return canProceed;
  }

  const addResourcesAnswer = inputs[AzureSolutionQuestionNames.AddResources] as string[];
  if (!addResourcesAnswer || addResourcesAnswer.length === 0) {
    return err(
      returnUserError(
        new Error(`answer of ${AzureSolutionQuestionNames.AddResources} is empty!`),
        SolutionSource,
        SolutionError.InvalidInput
      )
    );
  }

  const alreadyHaveFunction = settings.azureResources.includes(AzureResourceFunction.id);
  const alreadyHaveSql = settings.azureResources.includes(AzureResourceSQL.id);
  const alreadyHaveApim = settings.azureResources.includes(AzureResourceApim.id);
  const alreadyHaveKeyVault = settings.azureResources.includes(AzureResourceKeyVault.id);
  const addSQL = addResourcesAnswer.includes(AzureResourceSQL.id);
  const addFunc = addResourcesAnswer.includes(AzureResourceFunction.id);
  const addApim = addResourcesAnswer.includes(AzureResourceApim.id);
  const addKeyVault = addResourcesAnswer.includes(AzureResourceKeyVault.id);

  const selectedPlugins = settings.activeResourcePlugins;
  const functionPlugin = Container.get<v2.ResourcePlugin>(ResourcePluginsV2.FunctionPlugin);
  const sqlPlugin = Container.get<v2.ResourcePlugin>(ResourcePluginsV2.SqlPlugin);
  const apimPlugin = Container.get<v2.ResourcePlugin>(ResourcePluginsV2.ApimPlugin);
  const keyVaultPlugin = Container.get<v2.ResourcePlugin>(ResourcePluginsV2.KeyVaultPlugin);

  if ((alreadyHaveApim && addApim) || (alreadyHaveKeyVault && addKeyVault)) {
    const e = returnUserError(
      new Error("APIM/KeyVault is already added."),
      SolutionSource,
      SolutionError.AddResourceNotSupport
    );
    return err(
      sendErrorTelemetryThenReturnError(
        SolutionTelemetryEvent.AddResource,
        e,
        ctx.telemetryReporter
      )
    );
  }

  let addNewResourceToProvision = false;
  const notifications: string[] = [];
  const pluginsToScaffold: v2.ResourcePlugin[] = [];
  const pluginsToDoArm: v2.ResourcePlugin[] = [];
  const azureResource = Array.from(settings.azureResources || []);
  let scaffoldApim = false;
  if (addFunc || (addApim && !alreadyHaveFunction)) {
    pluginsToScaffold.push(functionPlugin);
    if (!azureResource.includes(AzureResourceFunction.id)) {
      azureResource.push(AzureResourceFunction.id);
      addNewResourceToProvision = true;
      pluginsToDoArm.push(functionPlugin);
    }
    notifications.push(AzureResourceFunction.label);
  }
  if (addSQL && !alreadyHaveSql) {
    pluginsToScaffold.push(sqlPlugin);
    pluginsToDoArm.push(sqlPlugin);
    azureResource.push(AzureResourceSQL.id);
    notifications.push(AzureResourceSQL.label);
    addNewResourceToProvision = true;
  }
  if (addApim && !alreadyHaveApim) {
    // We don't add apimPlugin into pluginsToScaffold because
    // apim plugin needs to modify config output during scaffolding,
    // which is not supported by the scaffoldSourceCode API.
    // The scaffolding will run later as a usertask as a work around.
    azureResource.push(AzureResourceApim.id);
    notifications.push(AzureResourceApim.label);
    addNewResourceToProvision = true;
    pluginsToDoArm.push(apimPlugin);
    scaffoldApim = true;
  }
  if (addKeyVault && !alreadyHaveKeyVault) {
    pluginsToScaffold.push(keyVaultPlugin);
    pluginsToDoArm.push(keyVaultPlugin);
    azureResource.push(AzureResourceKeyVault.id);
    notifications.push(AzureResourceKeyVault.label);
    addNewResourceToProvision = true;
  }
  if (notifications.length > 0) {
    if (isArmSupportEnabled() && addNewResourceToProvision) {
      showUpdateArmTemplateNotice(ctx.userInteraction);
    }
    settings.azureResources = azureResource;
    reloadV2Plugins(settings);
    ctx.logProvider?.info(`start scaffolding ${notifications.join(",")}.....`);
    let scaffoldRes = await scaffoldCodeAndResourceTemplate(
      ctx,
      inputs,
      localSettings,
      pluginsToScaffold,
      addNewResourceToProvision,
      pluginsToDoArm
    );

    if (scaffoldApim) {
      if (apimPlugin && apimPlugin.executeUserTask) {
        const result = await apimPlugin.executeUserTask(
          ctx,
          inputs,
          func,
          {},
          envInfo,
          tokenProvider
        );
        if (result.isErr()) {
          scaffoldRes = combine([scaffoldRes, result]);
        }
      }
    }

    if (scaffoldRes.isErr()) {
      ctx.logProvider?.info(`failed to scaffold ${notifications.join(",")}!`);
      return err(
        sendErrorTelemetryThenReturnError(
          SolutionTelemetryEvent.AddResource,
          scaffoldRes.error,
          ctx.telemetryReporter
        )
      );
    }

    ctx.logProvider?.info(`finish scaffolding ${notifications.join(",")}!`);
    ctx.userInteraction.showMessage(
      "info",
      util.format(
        inputs.platform === Platform.CLI
          ? getStrings().solution.AddResourceNoticeForCli
          : getStrings().solution.AddResourceNotice,
        notifications.join(",")
      ),
      false
    );
  }

  ctx.telemetryReporter?.sendTelemetryEvent(SolutionTelemetryEvent.AddResource, {
    [SolutionTelemetryProperty.Component]: SolutionTelemetryComponentName,
    [SolutionTelemetryProperty.Success]: SolutionTelemetrySuccess.Yes,
    [SolutionTelemetryProperty.Resources]: addResourcesAnswer.join(";"),
  });
  return ok(
    addNewResourceToProvision
      ? { solutionSettings: settings, solutionConfig: { provisionSucceeded: false } }
      : Void
  );
}

export function extractParamForRegisterTeamsAppAndAad(
  answers?: Inputs
): Result<ParamForRegisterTeamsAppAndAad, FxError> {
  if (answers == undefined) {
    return err(
      returnSystemError(
        new Error("Input is undefined"),
        SolutionSource,
        SolutionError.FailedToGetParamForRegisterTeamsAppAndAad
      )
    );
  }

  const param: ParamForRegisterTeamsAppAndAad = {
    "app-name": "",
    endpoint: "",
    environment: "local",
    "root-path": "",
  };
  for (const key of Object.keys(param)) {
    const value = answers[key];
    if (value == undefined) {
      return err(
        returnSystemError(
          new Error(`${key} not found`),
          SolutionSource,
          SolutionError.FailedToGetParamForRegisterTeamsAppAndAad
        )
      );
    }
    (param as any)[key] = value;
  }

  return ok(param);
}

export type ParamForRegisterTeamsAppAndAad = {
  "app-name": string;
  environment: "local" | "remote";
  endpoint: string;
  "root-path": string;
};
