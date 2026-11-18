export class ModelNotConfiguredError extends Error {
  constructor() {
    super("The judo analysis model has not been configured.");
    this.name = "ModelNotConfiguredError";
  }
}

export function isModelConfigured() {
  return false;
}

export async function analyzeVideo() {
  throw new ModelNotConfiguredError();
}
