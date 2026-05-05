#!/usr/bin/env bash
set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
tmp_dir="$repo_root/.tmp"
plans_dir="$tmp_dir/plans"

mkdir -p "$plans_dir"

if [ -d "$tmp_dir" ]; then
  find "$tmp_dir" -type f -mtime +7 -delete
fi
