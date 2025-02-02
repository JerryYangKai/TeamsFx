// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Result } from "neverthrow";
import { FxError } from "../error";
import { QTreeNode } from "../qm/question";
import { Inputs, Void } from "../types";
import { TokenProvider } from "../utils/login";
import { ResourceTemplate } from "../v2/resourcePlugin";
import { Context, DeepReadonly, InputsWithProjectPath } from "../v2/types";
import { EnvInfoV3, ManifestCapability } from "./types";

export interface AppManifestProvider {
  addCapabilities: (
    ctx: Context,
    inputs: InputsWithProjectPath,
    capabilities: ManifestCapability[]
  ) => Promise<Result<Void, FxError>>;

  updateCapability: (
    ctx: Context,
    inputs: InputsWithProjectPath,
    capability: ManifestCapability
  ) => Promise<Result<Void, FxError>>;

  deleteCapability: (
    ctx: Context,
    inputs: InputsWithProjectPath,
    capability: ManifestCapability
  ) => Promise<Result<Void, FxError>>;

  capabilityExceedLimit: (
    ctx: Context,
    inputs: InputsWithProjectPath,
    capability: "staticTab" | "configurableTab" | "Bot" | "MessageExtension" | "WebApplicationInfo"
  ) => Promise<Result<boolean, FxError>>;
}
export interface ContextWithManifestProvider extends Context {
  appManifestProvider: AppManifestProvider;
}

export interface AddFeatureInputs extends InputsWithProjectPath {
  allPluginsAfterAdd: string[];
}

export interface OtherFeaturesAddedInputs extends AddFeatureInputs {
  addedPlugins: {
    name: string; //plugin name
    value: ResourceTemplate[]; //plugin addFeature result
  }[];
}

export interface FeaturePlugin {
  /**
   * unique identifier for plugin in IoC container
   */
  name: string;
  /**
   * display name for the plugin
   */
  displayName?: string;
  /**
   * resource description
   */
  description?: string;

  /**
   * return dependent plugin names, when adding feature
   * If plugin A depends on plugin B, when plugin A is added into the project, plugin B will also be added
   */
  pluginDependencies?(ctx: Context, inputs: Inputs): Promise<Result<string[], FxError>>;

  /**
   * questions in add feature flow
   */
  getQuestionsForAddFeature?: (
    ctx: Context,
    inputs: Inputs
  ) => Promise<Result<QTreeNode | undefined, FxError>>;

  /**
   * triggered by add feature event, this API aims to add/modify files in local workspace
   *
   * @param {ContextWithManifestProvider} context with manifest provider
   * @param {AddFeatureInputs} inputs with plugins names after added
   * @returns {ResourceTemplate[]} resource template
   */
  addFeature: (
    ctx: ContextWithManifestProvider,
    inputs: AddFeatureInputs
  ) => Promise<Result<ResourceTemplate[], FxError>>;

  /**
   * triggered after other feature(s) is/are added
   * one scenario is that when feature A is added, feature plugin B should be notified after adding feature A.
   *
   * @param {ContextWithManifestProvider} context with manifest provider
   *
   * @param {OtherFeaturesAddedInputs} inputs with added features
   *
   * @param {EnvInfoV3} envInfo optional
   *
   * @returns {ResourceTemplate[]} resource template
   */
  afterOtherFeaturesAdded?: (
    ctx: ContextWithManifestProvider,
    inputs: OtherFeaturesAddedInputs
  ) => Promise<Result<ResourceTemplate[], FxError>>;

  /**
   * customized questions for provision
   */
  getQuestionsForProvision?: (
    ctx: Context,
    inputs: Inputs,
    envInfo: DeepReadonly<EnvInfoV3>,
    tokenProvider: TokenProvider
  ) => Promise<Result<QTreeNode | undefined, FxError>>;
  /**
   * provision includes provision local resource or remote resource
   */
  provisionResource?: (
    ctx: Context,
    inputs: InputsWithProjectPath,
    envInfo: EnvInfoV3,
    tokenProvider: TokenProvider
  ) => Promise<Result<Void, FxError>>;
  /**
   * config resources includes both local and remote
   */
  configureResource?: (
    ctx: Context,
    inputs: InputsWithProjectPath,
    envInfo: EnvInfoV3,
    tokenProvider: TokenProvider
  ) => Promise<Result<Void, FxError>>;

  /**
   * customized questions for deploy
   */
  getQuestionsForDeploy?: (
    ctx: Context,
    inputs: Inputs,
    envInfo: DeepReadonly<EnvInfoV3>,
    tokenProvider: TokenProvider
  ) => Promise<Result<QTreeNode | undefined, FxError>>;
  /**
   * deploy
   */
  deploy?: (
    ctx: Context,
    inputs: InputsWithProjectPath,
    envInfo: DeepReadonly<EnvInfoV3>,
    tokenProvider: TokenProvider
  ) => Promise<Result<Void, FxError>>;
}
