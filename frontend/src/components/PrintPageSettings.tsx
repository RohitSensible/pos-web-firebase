// CSS strings must escape quotes, backslashes and line breaks in outlet names.
function cssString(value: string): string {
  return `"${value.replace(/["\\\n\r\f]/g, character => `\\${character.charCodeAt(0).toString(16)} `)}"`;
}

export function PrintPageSettings({ outletName }: { outletName: string }) {
  return <style data-print-page-settings>{`
    @page {
      margin: 12mm;
      @top-left { content: ""; }
      @top-center { content: ""; }
      @top-right { content: ""; }
      @bottom-left { content: ${cssString(outletName)}; font: 9px sans-serif; color: #333; }
      @bottom-center { content: ""; }
      @bottom-right { content: ""; }
    }
  `}</style>;
}
