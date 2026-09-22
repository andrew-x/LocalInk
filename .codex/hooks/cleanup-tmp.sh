#!/usr/bin/env bash
set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
tmp_dir="$repo_root/.tmp"
plans_dir="$tmp_dir/plans"

if [ -L "$tmp_dir" ] || [ -L "$plans_dir" ]; then
  printf '%s\n' 'Temporary cleanup skipped: scratch directories must not be symlinks.' >&2
  exit 1
fi

if ! mkdir -p "$plans_dir" 2>/dev/null; then
  printf '%s\n' 'Temporary cleanup failed: scratch directories could not be created.' >&2
  exit 1
fi

# Do not follow nested symlinks. +6 selects files at least seven elapsed days old.
if ! find -P "$tmp_dir" -type f -mtime +6 -delete 2>/dev/null; then
  printf '%s\n' 'Temporary cleanup failed: stale scratch files could not be removed.' >&2
  exit 1
fi

printf '%s\n' 'Plan memory: create and maintain task plans in .tmp/plans/; scratch files are removed after seven days.'
