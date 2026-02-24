import {CodeTemplate} from "../CodeFile";
import {StructMeta} from "../StructMeta";

export function getUseNewCodeMethods(struct: StructMeta) {
    const ID = struct.idTsType || "number";
    return `
    private readonly freeIds: ${ID}[] = [];

    public new(): ${ID} {
        if (this.freeIds.length > 0) {
            return this.freeIds.pop();
        } else {
            if (this._size === this._max) {
                this.realloc(this._max * 2);
            }
            return ++this._size as ${ID};
        }
    }

    public free(ref: ${ID}): void {
        ${CodeTemplate.variable("free")}
        this.freeIds.push(ref);
    }`
}
