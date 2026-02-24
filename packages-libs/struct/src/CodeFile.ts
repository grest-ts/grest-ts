const VAR_PREFIX = "/* ---[[";
const VAR_SUFFIX = "]]--- */"

export class CodeFile {

    private readonly file: string[] = [];

    public push(...items: (string | CodeTemplate)[]) {
        if (items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                const txt = items[i];
                if (txt instanceof CodeTemplate) {
                    this.file.push(txt.build());
                } else {
                    this.file.push(txt);
                }
            }
        }
        return this;
    }

    public build() {
        return this.file.join("\n").replace(/(?:[ \t]*\r?\n){2,}/g, '\n\n'); // collapse empty lines.
    }

}

export class CodeTemplate {

    private readonly template: string;
    private readonly replacements: Map<string, string | CodeTemplateLines> = new Map();

    constructor(template: string) {
        this.template = template
    }

    public static create(template: string) {
        return new CodeTemplate(template);
    }

    public lines(key: string, callback: (lines: CodeTemplateLines) => void) {
        const lines = new CodeTemplateLines();
        this.replacements.set(key, lines);
        callback(lines);
        return this;
    }

    public static variable(key: string): string {
        return VAR_PREFIX + key + VAR_SUFFIX
    }

    public build() {
        const preLen = VAR_PREFIX.length;
        const sufLen = VAR_SUFFIX.length;
        let pos = 0;
        let result: string = "";
        while (true) {
            const open = this.template.indexOf(VAR_PREFIX, pos);
            if (open === -1) break;
            const close = this.template.indexOf(VAR_SUFFIX, open + preLen);
            if (close === -1) break;

            const pref = this.template.slice(pos, open);
            const varName = this.template.slice(open + preLen, close);
            pos = close + sufLen;

            const tabs = pref.substring(pref.lastIndexOf("\n"), pref.length);
            const replacement = String(this.replacements.get(varName)).replaceAll("\n", tabs);

            result += pref + replacement;
        }
        result += this.template.slice(pos);
        return result;
    }

}

export class CodeTemplateLines {

    private readonly parts: string[] = []

    constructor() {
    }

    public push(line: string) {
        this.parts.push(line);
    }

    public toString() {
        return this.parts.join("\n");
    }

}