"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
var client_1 = require("@prisma/client");
var adapter_pg_1 = require("@prisma/adapter-pg");
var pg_1 = __importDefault(require("pg"));
var globalForPrisma = globalThis;
function makePrismaClient() {
    var connectionString = process.env.DATABASE_URL;
    var pool = new pg_1.default.Pool({ connectionString: connectionString });
    var adapter = new adapter_pg_1.PrismaPg(pool);
    return new client_1.PrismaClient({ adapter: adapter });
}
exports.prisma = (_a = globalForPrisma.prisma) !== null && _a !== void 0 ? _a : makePrismaClient();
if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = exports.prisma;
}
exports.default = exports.prisma;
