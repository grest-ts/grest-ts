import {GGContextKey} from "@grest-ts/context"
import {type GGAuthzSubject, IsGGAuthzSubject} from "../shared/authzSchemas"

export const GG_AUTHZ_SUBJECT = new GGContextKey<GGAuthzSubject>("authzSubject", IsGGAuthzSubject, {
    description: "Who is calling: set by the auth wire handler, read by GGAuthz.authorize",
})
