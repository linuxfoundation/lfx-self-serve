#!/usr/bin/env bash

# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# A simple script that scans the go files checking for the license header.
# Exits with a 0 if all source files have license headers
# Exits with a 1 if one or more source files are missing a license header

# These are the file patterns we should exclude - these are typically transient files not checked into source control
exclude_pattern='node_modules|.vendor|.idea|gen|.venv|.ruff_cache|.pytest_cache|.angular|dist'

files=()
echo "Scanning source code..."
# Adjust this filters based on the source files you are interested in checking
# Loads all the filenames into an array
# We need optimize this, possibly use: -name '*.go' -o -name '*.txt' - not working as expected on mac
echo 'Searching *.go|go.mod files...'
files+=($(find . -type f \( -name '*.go' -o -name 'go.mod' \) -print | egrep -v ${exclude_pattern}))
echo "Searching python files..."
files+=($(find . -type f -name '*.py' -print | egrep -v ${exclude_pattern}))
echo "Searching html|css|ts|js files..."
files+=($(find . -type f \( -name '*.html' -o -name '*.css' -o -name '*.ts' -o -name '*.js' -o -name '*.scss' \) -print | egrep -v ${exclude_pattern})) # NOTE There must be a space between the parens and its contents or it won't work.
echo "Searching shell files..."
files+=($(find . -type f \( -name '*.sh' -o -name '*.bash' -o -name '*.ksh' -o -name '*.csh' -o -name '*.tcsh' -o -name '*.fsh' \) -print | egrep -v ${exclude_pattern})) # NOTE There must be a space between the parens and its contents or it won't work.
echo "Searching make files..."
files+=($(find . -type f -name 'Makefile' -print | egrep -v ${exclude_pattern}))
echo "Searching txt files..."
files+=($(find . -type f -name '*.txt' -print | egrep -v ${exclude_pattern}))
echo "Searching yaml|yml files..."
files+=($(find . -type f \( -name '*.yaml' -o -name '*.yml' \) -print | egrep -v ${exclude_pattern})) # NOTE There must be a space between the parens and its contents or it won't work.
files+=($(find . -type f -name '.gitignore' -print | egrep -v ${exclude_pattern}))
echo "Searching TOML files..."
files+=($(find . -type f -name '*.toml' -print | egrep -v ${exclude_pattern}))
echo "Searching SQL files..."
files+=($(find . -type f -name '*.sql' -print | egrep -v ${exclude_pattern}))

# This is the copyright line to look for - adjust as necessary
copyright_line="Copyright The Linux Foundation"

# Flag to indicate if we were successful or not
missing_license_header=0

# For each file...
echo "Checking ${#files[@]} source code files for the license header..."
for file in "${files[@]}"; do
  # echo "Processing file ${file}..."

  # Header is typically one of the first few lines in the file...
  head -4 "${file}" | grep -q "${copyright_line}"
  # Find it? exit code value of 0 indicates the grep found a match
  exit_code=$?
  if [[ ${exit_code} -ne 0 ]]; then
    echo "${file} is missing the license header"
    # update our flag - we'll fail the test
    missing_license_header=1
  fi
done

# Summary
if [[ ${missing_license_header} -eq 1 ]]; then
  echo "One or more source files is missing the license header."
else
  echo "License check passed."
fi

# Exit with status code 0 = success, 1 = failed
exit ${missing_license_header}
