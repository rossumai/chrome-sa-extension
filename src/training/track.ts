// src/training/track.ts
// DATA plus the two naming helpers. The curriculum is ONE fictional client
// project — Acme Freight's accounts payable — told across six missions. Every
// task is CHECKED (src/training/checks.ts); there are no self-attested steps.
//
// Checks find the trainee's OWN objects by exact name (spec 2026-11-13 §4), so
// other people working in the same org can neither tick nor un-tick a task.
// `{queue}`, `{dataset}` and `{rule}` in copy are replaced with those names.
//

/** What a task's check has to read. The loader fetches only these. */
export type Need = 'queue' | 'schema' | 'hooks' | 'rule' | 'dataset' | 'annotations';

export type Task = {
  id: string;
  /** One line. May name `{queue}`, `{dataset}` or `{rule}`, and mark code with backticks. */
  title: string;
  /** Why the client needs it — one or two sentences. */
  why: string;
  /** A breadcrumb in Rossum (or the Console) leading to the control. */
  where: string;
  needs: Need[];
};

export type Mission = {
  id: string;
  title: string;
  /** One line for the mission list. */
  summary: string;
  minutes: number;
  /** The client's message that opens the mission, one paragraph per entry. */
  letter: string[];
  tasks: Task[];
};

export type Track = {
  id: string;
  version: number;
  title: string;
  client: { name: string; initials: string; contact: string; role: string };
  missions: Mission[];
};

// Every run of the project gets its own code, and every object the trainee
// builds carries it, in Acme Freight's (fictional) IT naming convention: `AF`,
// the system, the run. The code is what tells the Academy which objects belong
// to THIS run — so starting over with a new code leaves an earlier run's objects
// out of every check, whether or not they were deleted.
const RUN_WORDS = [
  'barge',
  'crane',
  'dock',
  'ferry',
  'forklift',
  'harbor',
  'keel',
  'lantern',
  'pallet',
  'pier',
  'quay',
  'reefer',
  'rudder',
  'tanker',
  'tug',
  'winch',
];

/** A fresh run code, for example `barge-17`. */
export function newRunCode(random: () => number = Math.random): string {
  const word = RUN_WORDS[Math.floor(random() * RUN_WORDS.length) % RUN_WORDS.length];
  return `${word}-${10 + (Math.floor(random() * 90) % 90)}`;
}

/** True for a code newRunCode could have made — the only shape the names accept. */
export const isRunCode = (code: unknown): code is string =>
  typeof code === 'string' && /^[a-z]+-\d{2}$/.test(code);

export type Names = { queue: string; dataset: string; rule: string };

export function namesFor(run: string): Names {
  return {
    queue: `AF · AP Invoices · ${run}`,
    // Dataset names take no spaces or dots, so the convention's separator is `_` there.
    dataset: `af_vendor_master_${run.replace(/-/g, '_')}`,
    rule: `AF · PO required · ${run}`,
  };
}

/** Replaces `{queue}`, `{dataset}` and `{rule}` with the trainee's own names. */
export function fill(text: string, names: Names): string {
  return text.replace(/\{(queue|dataset|rule)\}/g, (_m, k: keyof Names) => names[k]);
}

export const TRACK: Track = {
  id: 'acme-ap',
  version: 1,
  title: 'Acme Freight goes live',
  client: {
    name: 'Acme Freight',
    initials: 'AF',
    contact: 'Dana Kowalski',
    role: 'AP lead at Acme Freight',
  },
  missions: [
    {
      id: 'kickoff',
      title: 'Kickoff',
      summary: 'A queue for Acme invoices',
      minutes: 5,
      letter: [
        'We receive about 1,200 supplier invoices a month by email, and three people type them into our ERP by hand.',
        'Let us start small: one queue for our AP invoices, so you have somewhere to build.',
      ],
      tasks: [
        {
          id: 'kickoff.queue',
          title: 'Create the queue `{queue}`',
          why: 'A queue is where documents arrive, and where every setting for them lives: the schema, extensions, rules and automation. Pick the Invoice template and the Generic engine: the AI fields this project uses come from it.',
          where: 'Documents › + at the bottom of the sidebar › Add queue (any workspace)',
          needs: ['queue'],
        },
      ],
    },
    {
      id: 'fields',
      title: 'Capture what Acme needs',
      summary: 'Three fields on the schema',
      minutes: 15,
      letter: [
        'Our ERP needs three things on every invoice that a generic template does not give us: the PO number, the supplier VAT number, and the vendor id from our vendor master.',
      ],
      tasks: [
        {
          id: 'fields.extract',
          title: 'Give the PO and VAT fields Acme’s IDs: `po_number` and `vendor_vat_id`',
          why: "The Invoice template already reads both: the PO number as `order_id` (Order Number) and the supplier's VAT number as `sender_vat_id`. Acme's ERP expects `po_number` and `vendor_vat_id`, so change the ID of those two existing fields, and don't add new ones: a renamed field keeps reading the same value from the invoice.",
          where: 'Documents › {queue} › gear button › Fields',
          needs: ['queue', 'schema'],
        },
        {
          id: 'fields.match',
          title: 'Add `vendor_match` as a list field',
          why: 'The matching extension writes the vendor it finds into a list field (type enum): the label is the vendor name, the value the vendor id from the master.',
          where: 'Documents › {queue} › gear button › Fields',
          needs: ['queue', 'schema'],
        },
      ],
    },
    {
      id: 'vendors',
      title: 'Load the vendor master',
      summary: '40 vendors in a dataset',
      minutes: 10,
      letter: [
        'Attached is our vendor export: 40 vendors with their VAT numbers. It is the same list our ERP checks every invoice against.',
      ],
      tasks: [
        {
          id: 'vendors.dataset',
          title: 'Create the dataset `{dataset}`',
          why: 'Master data lives in datasets. Create it by importing `acme-vendors.csv`, attached above, under exactly this name.',
          where: 'Console › Dataset Management › Import, or Rossum › Master Data Hub',
          needs: ['dataset'],
        },
        {
          id: 'vendors.records',
          title: 'Import all 40 vendors',
          why: 'Matching can only find a vendor that is in the dataset.',
          where: 'Console › Dataset Management › {dataset}',
          needs: ['dataset'],
        },
      ],
    },
    {
      id: 'matching',
      title: 'Match every invoice to a vendor',
      summary: 'Find the vendor by VAT number',
      minutes: 20,
      letter: [
        'Our ERP rejects any invoice whose vendor is not in the vendor master. That is where most of our rework comes from.',
        'Vendor names on invoices are never written the same way twice. The VAT number is. Can Rossum find the vendor before the invoice reaches us?',
      ],
      tasks: [
        {
          id: 'matching.hook',
          title: 'Add the Master Data Hub extension to your queue',
          why: 'The Master Data Hub extension looks each invoice up in a dataset while it is being reviewed. It runs as its token owner, so pick an admin of this organization there.',
          where: 'Extensions › Rossum Store › Master Data Hub',
          needs: ['queue', 'hooks'],
        },
        {
          id: 'matching.vat',
          title: 'Match on the VAT number first',
          why: 'Matching by name fails on "Nordic Pallet AB" versus "NORDIC PALLET A.B.". An exact match on the VAT number does not, so make it the first query.',
          where: 'Extensions › your Master Data Hub extension › Configuration',
          needs: ['queue', 'hooks'],
        },
        {
          id: 'matching.map',
          title: 'Write the vendor into `vendor_match`',
          why: "Acme's export needs the vendor id from the master, not the name printed on the invoice.",
          where: 'Extensions › your Master Data Hub extension › Configuration › Mapping',
          needs: ['queue', 'hooks'],
        },
      ],
    },
    {
      id: 'rules',
      title: 'Stop bad invoices early',
      summary: 'A rule for missing PO numbers',
      minutes: 10,
      letter: [
        'Invoices without a PO number bounce back from our ERP every single time. Please stop them before they leave Rossum.',
      ],
      tasks: [
        {
          id: 'rules.create',
          title: 'Create the rule `{rule}` on your queue',
          why: 'A rule checks every document in its queues while it is being reviewed, and acts when its condition is true. Rossum saves a rule only once it has a condition, so this and the next task usually pass together.',
          where: 'Documents › {queue} › gear button › Rules › Add rule',
          needs: ['queue', 'rule'],
        },
        {
          id: 'rules.block',
          title: 'Show an error when `po_number` is empty',
          why: 'An error message blocks confirmation and automation, so the invoice cannot leave Rossum without a PO number. A warning would let it through.',
          where: 'Documents › {queue} › gear button › Rules › {rule}',
          needs: ['queue', 'rule'],
        },
      ],
    },
    {
      id: 'golive',
      title: 'Go live with one invoice',
      summary: 'Confirm a real document',
      minutes: 10,
      letter: [
        'Let us try it on a real one. Send any invoice through your queue, and confirm it once it shows the right vendor.',
      ],
      tasks: [
        {
          id: 'golive.upload',
          title: 'Upload an invoice to your queue',
          why: 'Any invoice works. Uploading, emailing it to the queue inbox and the API all land in the same place.',
          where: 'Documents › {queue} › Upload',
          needs: ['queue', 'annotations'],
        },
        {
          id: 'golive.confirm',
          title: 'Confirm it with a vendor matched',
          why: 'If the vendor is not in the master, type `SE556677889901` (Nordic Pallet AB) into `vendor_vat_id`: the extension matches it again as soon as the value changes.',
          where: 'Documents › {queue} › your invoice › Confirm',
          needs: ['queue', 'annotations'],
        },
      ],
    },
  ],
};

/** Every task, in order, with its mission. */
export function allTasks(track: Track): Array<{ mission: Mission; task: Task }> {
  return track.missions.flatMap((mission) => mission.tasks.map((task) => ({ mission, task })));
}
