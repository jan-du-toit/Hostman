# Installer components

Hostman code is copyright 2026 ByDT Softwares, under the MIT License.

The compiled Windows setup executable uses NSIS 3.09 and its installer stub,
Modern UI and LZMA decompression components. NSIS is developed by Nullsoft and
contributors. The source, licensing information and build documentation are
available at https://nsis.sourceforge.io/ and https://nsis.sourceforge.io/License.

The Linux installer may download Node.js from nodejs.org, retaining the upstream
LICENSE file in its runtime directory. Windows prerequisite packages are
installed by their upstream installers through WinGet and retain their own
licenses. They are not included inside the Hostman executable.
