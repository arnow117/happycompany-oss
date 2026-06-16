import type { SkillToolDef } from './tool-schemas.js';

export interface BuiltTool {
  name: string;
  description: string;
  riskLevel: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  appName: string;
}

export interface SkillToolSource {
  appName: string;
  toolDefs?: SkillToolDef[];
}

export class SkillToolBuilder {
  buildTool(toolDef: SkillToolDef, appName: string): BuiltTool | null {
    if (!toolDef?.name || !toolDef?.description) return null;
    return {
      name: `${appName}:${toolDef.name}`,
      description: toolDef.description,
      riskLevel: toolDef.riskLevel,
      parameters: toolDef.parameters,
      appName,
    };
  }

  buildToolsForSkill(source: SkillToolSource): BuiltTool[] {
    if (!source.toolDefs?.length) return [];
    return source.toolDefs
      .map(def => this.buildTool(def, source.appName))
      .filter((t): t is BuiltTool => t !== null);
  }
}
