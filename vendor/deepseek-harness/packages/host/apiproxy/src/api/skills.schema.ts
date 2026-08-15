/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { SkillAdminView, SkillEntry } from './skills.ts'

/** SkillEntry row of skill.list. */
export const skillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
}) satisfies z.ZodType<Wire<SkillEntry>>

/** SkillAdminView row of the management methods. */
export const skillAdminViewSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
  userInvocable: z.boolean(),
  source: z.string(),
  provider: z.string(),
  owned: z.boolean(),
  path: z.string().optional(),
}) satisfies z.ZodType<Wire<SkillAdminView>>

/** skill.list request payload. */
export const skillListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.list'>>>

/** skill.list response value. */
export const skillListValueSchema = z.object({
  skills: z.array(skillEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.list'>>>

/** skill.catalog request payload. */
export const skillCatalogRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'skill.catalog'>>>

/** skill.catalog response value. */
export const skillCatalogValueSchema = z.object({
  skills: z.array(skillAdminViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.catalog'>>>

/** skill.read request payload. */
export const skillReadRequestSchema = z.object({
  name: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.read'>>>

/** skill.read response value. */
export const skillReadValueSchema = z.object({
  entry: skillAdminViewSchema,
  content: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.read'>>>

/** skill.save request payload. */
export const skillSaveRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  content: z.string(),
  modelInvocable: z.boolean(),
  userInvocable: z.boolean(),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.save'>>>

/** skill.save response value. */
export const skillSaveValueSchema = z.object({
  entry: skillAdminViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'skill.save'>>>

/** skill.remove request payload. */
export const skillRemoveRequestSchema = z.object({
  name: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.remove'>>>

/** skill.remove response value. */
export const skillRemoveValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'skill.remove'>>>
