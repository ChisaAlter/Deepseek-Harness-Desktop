# Agent Note: Local Files search filtering

English | [中文](2026-09-05-files-local-search-filter.zh.md)

Status: implemented

## Decision

The Files picker filters locally walked entries by matching file names or paths before applying the result limit. Matching order, subsequence highlights and empty-query behavior are preserved.

## Rationale

Production acceptance of desktop CI run 33942243475 showed unrelated files for a README query. The picker calculated highlight positions but kept rows with no match, treating a local directory walk as an already-filtered server response. Unit and panel tests now assert exclusion of unrelated files and a limit applied after filtering. This source fix does not validate the previously installed artifact.
