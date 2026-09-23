/** Load the spreadsheet renderer only when a supported workbook is opened. */
import { lazy, Suspense, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentPreviewProps } from '../document/contract.ts'
import { excelFormat, type ExcelFormat } from './format.ts'
import type { ExcelLimits } from './model.ts'
import { hostFileOf } from '../rpc.ts'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import css from '../TextPreview.module.css'

/** Document input plus parser limits and localized copy. */
export type ExcelBodyProps = DocumentPreviewProps & PropsLocale<'sidebarExcel'> & { readonly limits: ExcelLimits }

/** Lazily loaded renderer input with the filename-derived parser choice. */
export type LoadedExcelBodyProps = ExcelBodyProps & { readonly format: ExcelFormat }

const LoadedExcelBody = lazy(async () => ({ default: (await import('./excel.tsx')).ExcelBody }))

/**
 * Load the browser spreadsheet renderer for every registered format.
 * @param props - Complete file bytes and standard document seats.
 * @returns Localized loading state or Excel preview.
 */
export function LazyExcelBody(props: ExcelBodyProps): ReactNode {
  const format = excelFormat(hostFileOf(props.resourceAddress).path)
  return <Suspense fallback={<LoadingIndicator className={css.status} label={props.t('loading')} />}>
    <LoadedExcelBody {...props} format={format} />
  </Suspense>
}
