# NoteBi third-party notices

NoteBi desktop preview packages bundle the following command-line tools in
addition to the dependencies declared by the source tree.

## FFmpeg and FFprobe

- Component: FFmpeg / FFprobe 6.1.1 static builds
- Upstream source: <https://ffmpeg.org/>
- Binary source: <https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1>
- License: GNU General Public License version 3 or later for the selected builds
- Build-specific license file: bundled in the installed application as
  `resources/FFMPEG-LICENSE.txt`

The GitHub build workflow downloads the Windows x64 or Linux x64 binaries and
license from that fixed release and verifies every file against a pinned
SHA-256 checksum before packaging it. Model weights are not bundled with the
installer; users download models explicitly from NoteBi settings.
