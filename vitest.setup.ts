import fc from "fast-check";

// FC_RUNS=2000 npm test para una búsqueda más exhaustiva de casos borde.
fc.configureGlobal({ numRuns: Number(process.env.FC_RUNS ?? 100) });
