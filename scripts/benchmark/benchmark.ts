/**
 * Compares `entities` with other entity libraries across several inputs.
 *
 * Each library/input pair runs in its own process, so JIT state and garbage
 * from one measurement can't leak into another. Rounds run the pairs in a
 * shuffled order, and the reported number is the median across rounds.
 *
 * Usage: `npm run benchmark -- [--rounds 3] [--time 1000] [--filter decode/named]`
 * (`--filter` matches `operation/input`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as he from "he";
import * as htmlEntities from "html-entities";
import { parseEntities } from "parse-entities";
import { Bench } from "tinybench";
import * as entities from "../../src/index.js";

type Run = (input: string) => string;

interface Operation {
    title: string;
    /** Implementations, keyed by library name. `entities` comes first. */
    libraries: Record<string, Run>;
    inputs: Record<string, { label: string; text: string }>;
    /** Throws if a library's output is wrong for an input. */
    check(input: string, output: string, reference: string): void;
}

/** Deterministic PRNG (mulberry32), so every process sees the same inputs. */
function random(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d_2b_79_f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

/** Shuffles `list` in place (Fisher–Yates). */
function shuffle<T>(list: T[], next: () => number): T[] {
    for (let index = list.length - 1; index > 0; index--) {
        const other = Math.floor(next() * (index + 1));
        [list[index], list[other]] = [list[other], list[index]];
    }
    return list;
}

/**
 * Builds text of about `bytes` UTF-8 bytes from `words`, inserting one of
 * `extras` instead of a word with probability `rate`.
 */
function text(
    seed: number,
    bytes: number,
    words: string[],
    extras: string[] = [],
    rate = 0,
): string {
    const next = random(seed);
    const pick = (list: string[]) => list[Math.floor(next() * list.length)];
    let out = "";
    while (Buffer.byteLength(out) < bytes) {
        out += next() < rate ? pick(extras) : pick(words);
        out += next() < 0.1 ? ". " : " ";
    }
    return out;
}

const englishWords =
    "the of and to in is was that for it with as on be at by this had not are but from or have an they which one you were all we her she there would their will when who him been has more if no out so said what up its about than into them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three".split(
        " ",
    );

const accentedWords =
    "über Straße schön Größe Mädchen fünf Bücher müssen grün Käse Fußball heißt café élève garçon déjà naïve œuvre être français où très frère hôtel Noël señor año niño mañana und der die das ist nicht mit sich auf für le la les et est un une pour dans avec sur el los con por".split(
        " ",
    );

const cjkAndEmoji =
    "你好 世界 数据 编码 解码 字符 实体 测试 こんにちは ありがとう データ 文字 안녕하세요 데이터 😀 👍🏽 ❤️ 🎉 🚀 👨‍👩‍👧 🇩🇪 ✨ abc 123".split(
        " ",
    );

const commonReferences = [
    "&amp;",
    "&nbsp;",
    "&quot;",
    "&lt;",
    "&gt;",
    "&copy;",
    "&mdash;",
    "&hellip;",
    "&rsquo;",
    "&eacute;",
    "&uuml;",
    "&#39;",
    "&#8212;",
    "&#x2019;",
];

const specialCharacters = ["&", "<", ">", '"', "'", "AT&T", "a<b", '"quoted"'];

/**
 * All HTML entity names, shuffled so lookups don't benefit from ordering.
 * Skips `lang` and `rang`, which html-entities still decodes to their HTML 4
 * code points.
 */
const allNamedReferences = (() => {
    const names = Object.keys(
        JSON.parse(
            readFileSync(
                new URL("../../maps/entities.json", import.meta.url),
                "utf8",
            ),
        ),
    ).filter((name) => name !== "lang" && name !== "rang");
    return shuffle(names, random(7))
        .map((name) => `&${name};`)
        .join(" ");
})();

const numericReferences = (() => {
    const next = random(11);
    // Printable ASCII, Latin-1, general BMP and astral code points.
    const ranges = [
        [0x21, 0x7e],
        [0xa0, 0xff],
        [0x1_00, 0xd7_ff],
        [0x1_00_00, 0x1_f6_ff],
    ];
    let out = "";
    while (out.length < 4096) {
        const [min, max] = ranges[Math.floor(next() * ranges.length)];
        const cp = min + Math.floor(next() * (max - min + 1));
        out += next() < 0.5 ? `&#${cp};` : `&#x${cp.toString(16)};`;
    }
    return out;
})();

const shortDecodeInput = "This is a simple text &uuml;ber &#x3f; something.";
const shortEncodeInput = "über & unter's sprießende <boo> ❤️👊😉";

const markup = (() => {
    const next = random(13);
    const tags = ["p", "a", "span", "li", "em", "div"];
    let out = "";
    while (out.length < 4096) {
        const tag = tags[Math.floor(next() * tags.length)];
        const words = text(Math.floor(next() * 1e9), 40, englishWords);
        out += `<${tag} class="c${Math.floor(next() * 100)}" data-x='${tag}'>${words}</${tag}>\n`;
    }
    return out;
})();

/** Encoded and escaped output must decode back to the input. */
function checkRoundTrip(input: string, output: string): void {
    if (entities.decodeHTML(output) !== input) {
        throw new Error("Output does not decode back to the input");
    }
}

const operations: Record<string, Operation> = {
    decode: {
        title: "Decoding",
        libraries: {
            entities: (input) => entities.decodeHTML(input),
            "html-entities": (input) =>
                htmlEntities.decode(input, { level: "html5", scope: "body" }),
            he: (input) => he.decode(input),
            "parse-entities": (input) => parseEntities(input),
        },
        inputs: {
            short: { label: "Short text", text: shortDecodeInput },
            plain: {
                label: "Prose, no references",
                text: text(1, 4096, englishWords),
            },
            prose: {
                label: "Prose, some references",
                text: text(2, 4096, englishWords, commonReferences, 0.1),
            },
            named: {
                label: "All named references",
                text: allNamedReferences,
            },
            numeric: { label: "Numeric references", text: numericReferences },
        },
        check(_input, output, reference) {
            if (output !== reference) {
                throw new Error("Output differs from `entities`");
            }
        },
    },
    encode: {
        title: "Encoding",
        libraries: {
            entities: (input) => entities.encodeNonAsciiHTML(input),
            "html-entities": (input) =>
                htmlEntities.encode(input, {
                    level: "html5",
                    mode: "nonAsciiPrintable",
                }),
            he: (input) => he.encode(input, { useNamedReferences: true }),
        },
        inputs: {
            short: { label: "Short text", text: shortEncodeInput },
            ascii: {
                label: "ASCII prose",
                text: text(3, 4096, englishWords, specialCharacters, 0.02),
            },
            latin: {
                label: "Accented prose",
                text: text(4, 4096, accentedWords, specialCharacters, 0.02),
            },
            cjk: { label: "CJK and emoji", text: text(5, 4096, cjkAndEmoji) },
        },
        check: checkRoundTrip,
    },
    escape: {
        title: "Escaping",
        libraries: {
            entities: (input) => entities.escapeUTF8(input),
            "html-entities": (input) =>
                htmlEntities.encode(input, {
                    level: "xml",
                    mode: "specialChars",
                }),
            he: (input) => he.escape(input),
        },
        inputs: {
            short: { label: "Short text", text: shortEncodeInput },
            prose: {
                label: "Prose",
                text: text(6, 4096, englishWords, specialCharacters, 0.02),
            },
            markup: { label: "Markup", text: markup },
        },
        check: checkRoundTrip,
    },
};

interface Job {
    operation: string;
    input: string;
    library: string;
}

const jobId = ({ operation, input, library }: Job) =>
    `${operation}/${input}/${library}`;

/** Measures one job and returns calls per second. */
async function measure(job: Job, time: number): Promise<number> {
    const run = operations[job.operation].libraries[job.library];
    const input = operations[job.operation].inputs[job.input].text;
    let sink = 0;

    // Batch calls so each sample takes ~20µs, keeping timer overhead out of
    // short inputs.
    let calls = 0;
    const start = performance.now();
    while (performance.now() - start < 100) {
        sink += run(input).length;
        calls++;
    }
    const batch = Math.max(
        1,
        Math.round((20e-3 * calls) / (performance.now() - start)),
    );

    const bench = new Bench({ time, warmupTime: 200 });
    bench.add(jobId(job), () => {
        for (let index = 0; index < batch; index++) {
            sink += run(input).length;
        }
    });
    await bench.run();

    const { result } = bench.tasks[0];
    if (result.state !== "completed" || sink === 0) {
        throw new Error(`${jobId(job)} did not complete`);
    }
    return (batch * 1000) / result.latency.p50;
}

function version(library: string): string {
    const packageJson = new URL(
        `node_modules/${library}/package.json`,
        import.meta.url,
    );
    return (
        JSON.parse(readFileSync(packageJson, "utf8")) as { version: string }
    ).version;
}

/** Formats with one decimal below `threshold`, and none above. */
function formatNumber(value: number, threshold: number): string {
    const digits = value < threshold ? 1 : 0;
    return value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function formatRate(bytesPerSecond: number): string {
    return `${formatNumber(bytesPerSecond / 1e6, 100)} MB/s`;
}

function formatSize(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

function printTable(
    name: string,
    operation: Operation,
    rates: Map<string, number>,
): void {
    const libraries = Object.keys(operation.libraries);
    const header = [
        "Input",
        "Size",
        ...libraries.map((library) =>
            library === "entities" ? library : `${library} ${version(library)}`,
        ),
    ];
    const measured = Object.entries(operation.inputs).filter(([input]) =>
        rates.has(jobId({ operation: name, input, library: "entities" })),
    );
    const rows = measured.map(([input, { label, text }]) => {
        const bytes = Buffer.byteLength(text);
        const rate = (library: string) =>
            bytes * rates.get(jobId({ operation: name, input, library }))!;
        const baseline = rate("entities");
        return [
            label,
            formatSize(bytes),
            ...libraries.map((library) => {
                const current = rate(library);
                if (library === "entities") return formatRate(current);
                const factor = baseline / current;
                return factor >= 1
                    ? `${formatRate(current)} (${formatNumber(factor, 10)}× slower)`
                    : `${formatRate(current)} (${formatNumber(1 / factor, 10)}× faster)`;
            }),
        ];
    });

    const widths = header.map((_, column) =>
        Math.max(...[header, ...rows].map((row) => row[column].length)),
    );
    const line = (cells: string[]) =>
        `| ${cells
            .map((cell, column) =>
                column < 1
                    ? cell.padEnd(widths[column])
                    : cell.padStart(widths[column]),
            )
            .join(" | ")} |`;

    console.log(`### ${operation.title}\n`);
    console.log(line(header));
    console.log(
        `| ${widths
            .map((width, column) =>
                column < 1 ? "-".repeat(width) : `${"-".repeat(width - 1)}:`,
            )
            .join(" | ")} |`,
    );
    for (const row of rows) console.log(line(row));
    console.log();
}

const { values } = parseArgs({
    options: {
        worker: { type: "string" },
        rounds: { type: "string", default: "3" },
        time: { type: "string", default: "1000" },
        filter: { type: "string", default: "" },
    },
});
const time = Number(values.time);

if (values.worker) {
    const [operation, input, library] = values.worker.split("/");
    console.log(await measure({ operation, input, library }, time));
} else {
    const jobs: Job[] = [];
    for (const [operation, { inputs, libraries, check }] of Object.entries(
        operations,
    )) {
        for (const [input, { text }] of Object.entries(inputs)) {
            if (!`${operation}/${input}`.includes(values.filter)) continue;
            const reference = libraries["entities"](text);
            for (const [library, run] of Object.entries(libraries)) {
                const job = { operation, input, library };
                try {
                    check(text, run(text), reference);
                } catch (error) {
                    throw new Error(
                        `${jobId(job)}: ${(error as Error).message}`,
                    );
                }
                jobs.push(job);
            }
        }
    }

    const rounds = Number(values.rounds);
    const samples = new Map<string, number[]>();
    const next = random(Date.now());
    for (let round = 1; round <= rounds; round++) {
        const order = shuffle([...jobs], next);
        for (const [index, job] of order.entries()) {
            process.stderr.write(
                `\rRound ${round}/${rounds}, ${index + 1}/${order.length}: ${jobId(job)}`.padEnd(
                    60,
                ),
            );
            const child = spawnSync(
                process.execPath,
                [
                    ...process.execArgv,
                    fileURLToPath(import.meta.url),
                    "--worker",
                    jobId(job),
                    "--time",
                    String(time),
                ],
                { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
            );
            if (child.status !== 0) throw new Error(`${jobId(job)} failed`);
            const id = jobId(job);
            samples.set(id, [...(samples.get(id) ?? []), Number(child.stdout)]);
        }
    }
    process.stderr.write("\n\n");

    const rates = new Map(
        [...samples].map(([id, runs]) => {
            const sorted = [...runs].sort((a, b) => a - b);
            return [id, sorted[Math.floor(sorted.length / 2)]];
        }),
    );
    for (const [name, operation] of Object.entries(operations)) {
        if (jobs.some((job) => job.operation === name)) {
            printTable(name, operation, rates);
        }
    }
}
