export type tCompanyId = number & { tCompanyId: true };

export interface Company {
    id: tCompanyId;
    name: string;
    age: number
}

export interface CompanyForEdit {
    name: unknown;
    age: number
}
