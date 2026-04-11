// IP Address (IPv4 or IPv6)
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const ipError = new GGIssueInvalid("ip", "Invalid IPv4 or IPv6 address");
const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_REGEX = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/;
const isValidIp = (v: string): boolean => {
    const ipv4Match = v.match(IPV4_REGEX);
    if (ipv4Match) {
        return ipv4Match.slice(1, 5).every(octet => {
            const n = parseInt(octet, 10);
            return n >= 0 && n <= 255;
        });
    }
    return IPV6_REGEX.test(v);
};
export const IsIp = Object.assign(
    IsString.refine(isValidIp, ipError).brand("ip")    .docs({
        title: "IP address",
        format: "ip",
        description: "IPv4 or IPv6",
        examples: ["192.168.1.1", "::1"]
    }),
    {ipError}
);
export type tIp = typeof IsIp.infer;