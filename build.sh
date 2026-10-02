#!/bin/bash
# Builds dist/conversation-alerts.vsix and dist/conversation-alerts.zip (the package to share).
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(python3 -c "import json; print(json.load(open('extension/package.json'))['version'])")
rm -rf build dist && mkdir -p build/vsix/extension dist

cp extension/package.json extension/extension.js build/vsix/extension/
cat > build/vsix/extension.vsixmanifest <<XML
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="claude-code-conversation-alerts" Version="$VERSION" Publisher="sreekanth-anubolu"/>
    <DisplayName>Conversation Alerts for Claude Code</DisplayName>
    <Description xml:space="preserve">Alerts you when a Claude Code conversation needs you, and opens it. Not affiliated with Anthropic.</Description>
    <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.80.0"/></Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets>
</PackageManifest>
XML
cat > "build/vsix/[Content_Types].xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>
XML
(cd build/vsix && zip -qX ../../dist/conversation-alerts.vsix "[Content_Types].xml" extension.vsixmanifest extension/package.json extension/extension.js)

mkdir -p build/conversation-alerts
cp hook/notify.py sounds/siren.wav install.sh uninstall.sh README.md LICENSE dist/conversation-alerts.vsix build/conversation-alerts/
(cd build && zip -qrX ../dist/conversation-alerts.zip conversation-alerts)
rm -rf build
echo "Built dist/conversation-alerts.vsix and dist/conversation-alerts.zip (v$VERSION)"
