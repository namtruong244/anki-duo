import type { NoteTypeKind, NoteTypeOptions } from './interaction.js';

export interface NoteField {
  id: string;
  name: string;
}
export interface NoteTemplate {
  id: string;
  name: string;
  front: string;
  back: string;
}
export interface NoteTypeDef {
  fields: NoteField[];
  templates: NoteTemplate[];
  css: string;
  /** default 'standard' */
  kind?: NoteTypeKind;
  /** default {} */
  options?: NoteTypeOptions;
}
/** fieldId -> HTML */
export type NoteFields = Record<string, string>;
