/** Public questionnaire deployment options shared by Host and Client. */
import z from '@deepseek-ai/schemastery'

/** Questionnaire destination and its supported source option. */
export interface Config {
  /** HTTPS questionnaire URL; override for a test form. */
  contactFormUrl: string
  /** Questionnaire source option; empty until Harness is supported by the form. */
  contactSource: string
}
/** Validate public questionnaire options. */
export const Config: z<Partial<Config>, Config> = z.object({
  contactFormUrl: z.string().pattern(/^https:\/\/[^/\s]+\//).default('https://trtgsjkv6r.feishu.cn/share/base/form/shrcnlCoGElW7MQznGy9r3YYXcg'),
  contactSource: z.string().default(''),
})
/** Bootstrap key containing no account credentials. */
export const CONTACT_CONFIG_GLOBAL = '__DSH_CONTACT_CONFIG__'
