import {
  v2,
  Inputs,
  FxError,
  TokenProvider,
  returnSystemError,
  Json,
} from "@microsoft/teamsfx-api";
import { executeConcurrently } from "./executor";
import {
  checkWhetherLocalDebugM365TenantMatches,
  ensurePermissionRequest,
  getAzureSolutionSettings,
  getSelectedPlugins,
  isAzureProject,
  loadTeamsAppTenantIdForLocal,
} from "./utils";
import { PluginNames, SolutionError, SolutionSource } from "../constants";
import { isUndefined } from "lodash";
import Container from "typedi";
import { ResourcePluginsV2 } from "../ResourcePluginContainer";
import { environmentManager } from "../../../../core/environment";
import { PermissionRequestFileProvider } from "../../../../core/permissionRequest";
import { LocalSettingsTeamsAppKeys } from "../../../../common/localSettingsConstants";
import {
  configLocalDebugSettings,
  configLocalEnvironment,
  setupLocalDebugSettings,
  setupLocalEnvironment,
} from "../debug/provisionLocal";
import { isConfigUnifyEnabled } from "../../../../common/tools";
import { EnvInfoV2 } from "@microsoft/teamsfx-api/build/v2";
import { ResourcePlugins } from "../../../../common/constants";

export async function provisionLocalResource(
  ctx: v2.Context,
  inputs: Inputs,
  localSettings: Json,
  tokenProvider: TokenProvider,
  envInfo?: EnvInfoV2
): Promise<v2.FxResult<Json, FxError>> {
  if (inputs.projectPath === undefined) {
    return new v2.FxFailure(
      returnSystemError(
        new Error("projectPath is undefined"),
        "Solution",
        SolutionError.InternelError
      )
    );
  }
  const azureSolutionSettings = getAzureSolutionSettings(ctx);
  if (isAzureProject(azureSolutionSettings)) {
    if (ctx.permissionRequestProvider === undefined) {
      ctx.permissionRequestProvider = new PermissionRequestFileProvider(inputs.projectPath);
    }
    const result = await ensurePermissionRequest(
      azureSolutionSettings!,
      ctx.permissionRequestProvider
    );
    if (result.isErr()) {
      return new v2.FxFailure(result.error);
    }
  }

  // Just to trigger M365 login before the concurrent execution of localDebug.
  // Because concurrent execution of localDebug may getAccessToken() concurrently, which
  // causes 2 M365 logins before the token caching in common lib takes effect.
  await tokenProvider.appStudioToken.getAccessToken();

  // Pop-up window to confirm if local debug in another tenant
  let localDebugTenantId = "";
  if (isConfigUnifyEnabled()) {
    localDebugTenantId = envInfo?.state.solution.teamsAppTenantId;
  } else {
    localDebugTenantId = localSettings.teamsApp[LocalSettingsTeamsAppKeys.TenantId];
  }

  const m365TenantMatches = await checkWhetherLocalDebugM365TenantMatches(
    localDebugTenantId,
    tokenProvider.appStudioToken
  );
  if (m365TenantMatches.isErr()) {
    return new v2.FxFailure(m365TenantMatches.error);
  }

  const plugins: v2.ResourcePlugin[] = getSelectedPlugins(ctx.projectSetting);
  const provisionLocalResourceThunks = plugins
    .filter((plugin) => !isUndefined(plugin.provisionLocalResource))
    .map((plugin) => {
      return {
        pluginName: `${plugin.name}`,
        taskName: "provisionLocalResource",
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        thunk: () =>
          plugin.provisionLocalResource!(ctx, inputs, localSettings, tokenProvider, envInfo),
      };
    });

  const provisionResult = await executeConcurrently(provisionLocalResourceThunks, ctx.logProvider);
  if (provisionResult.kind !== "success") {
    return provisionResult;
  }

  if (isConfigUnifyEnabled()) {
    const localEnvSetupResult = await setupLocalEnvironment(ctx, inputs, envInfo!);

    if (localEnvSetupResult.isErr()) {
      return new v2.FxPartialSuccess(envInfo!, localEnvSetupResult.error);
    }

    setDataForLocal(envInfo!, localSettings);
  } else {
    const debugProvisionResult = await setupLocalDebugSettings(ctx, inputs, localSettings);

    if (debugProvisionResult.isErr()) {
      return new v2.FxPartialSuccess(localSettings, debugProvisionResult.error);
    }
  }

  const aadPlugin = Container.get<v2.ResourcePlugin>(ResourcePluginsV2.AadPlugin);
  if (isAzureProject(azureSolutionSettings)) {
    if (plugins.some((plugin) => plugin.name === aadPlugin.name) && aadPlugin.executeUserTask) {
      const result = await aadPlugin.executeUserTask(
        ctx,
        inputs,
        {
          namespace: `${PluginNames.SOLUTION}/${PluginNames.AAD}`,
          method: "setApplicationInContext",
          params: { isLocal: isConfigUnifyEnabled() ? false : true },
        },
        localSettings,
        isConfigUnifyEnabled()
          ? envInfo!
          : { envName: environmentManager.getDefaultEnvName(), config: {}, state: {} },
        tokenProvider
      );
      if (result.isErr()) {
        return new v2.FxPartialSuccess(localSettings, result.error);
      }
    }
  }

  const parseTenantIdresult = loadTeamsAppTenantIdForLocal(
    localSettings as v2.LocalSettings,
    await tokenProvider.appStudioToken.getJsonObject(),
    envInfo
  );
  if (parseTenantIdresult.isErr()) {
    return new v2.FxFailure(parseTenantIdresult.error);
  }

  const configureLocalResourceThunks = plugins
    .filter((plugin) => !isUndefined(plugin.configureLocalResource))
    .map((plugin) => {
      return {
        pluginName: `${plugin.name}`,
        taskName: "configureLocalResource",
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        thunk: () =>
          plugin.configureLocalResource!(ctx, inputs, localSettings, tokenProvider, envInfo),
      };
    });

  const configureResourceResult = await executeConcurrently(
    configureLocalResourceThunks,
    ctx.logProvider
  );

  if (configureResourceResult.kind !== "success") {
    if (configureResourceResult.kind === "partialSuccess") {
      return new v2.FxPartialSuccess(localSettings, configureResourceResult.error);
    }
    return new v2.FxFailure(configureResourceResult.error);
  }

  if (isConfigUnifyEnabled()) {
    setPostDataForLocal(envInfo!, localSettings);
    const localConfigResult = await configLocalEnvironment(ctx, inputs, envInfo!);

    if (localConfigResult.isErr()) {
      return new v2.FxPartialSuccess(envInfo!, localConfigResult.error);
    }
  } else {
    const debugConfigResult = await configLocalDebugSettings(ctx, inputs, localSettings);

    if (debugConfigResult.isErr()) {
      return new v2.FxPartialSuccess(localSettings, debugConfigResult.error);
    }
  }

  return new v2.FxSuccess(localSettings);
}

// TODO: delete me later, this is used to set localSettings using envInfo.state value
export function setDataForLocal(envInfo: EnvInfoV2, localSettings: Json) {
  localSettings.auth.clientId = envInfo.state[ResourcePlugins.Aad].clientId;
  localSettings.auth.clientSecret = envInfo.state[ResourcePlugins.Aad].clientSecret;
  localSettings.auth.objectId = envInfo.state[ResourcePlugins.Aad].objectId;
  localSettings.auth.oauth2PermissionScopeId =
    envInfo.state[ResourcePlugins.Aad].oauth2PermissionScopeId;
  localSettings.auth.oauthAuthority = envInfo.state[ResourcePlugins.Aad].oauthAuthority;
  localSettings.auth.oauthHost = envInfo.state[ResourcePlugins.Aad].oauthHost;

  localSettings.frontend.tabIndexPath = envInfo.state[ResourcePlugins.FrontendHosting].indexPath;
  localSettings.frontend.tabDomain = envInfo.state[ResourcePlugins.FrontendHosting].domain;
  localSettings.frontend.tabEndpoint = envInfo.state[ResourcePlugins.FrontendHosting].endpoint;
}

export function setPostDataForLocal(envInfo: EnvInfoV2, localSettings: Json) {
  localSettings.auth.applicationIdUris = envInfo.state[ResourcePlugins.Aad].applicationIdUris;
  localSettings.teamsApp.teamsAppId = envInfo.state[ResourcePlugins.AppStudio]?.teamsAppId;
}
