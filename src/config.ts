import type { PurposeConfig } from './index.ts';
import {
  describe,
  isFunction,
  isPlainObject,
  isValidId,
  isVersion,
  type PlainObject,
} from './validation.ts';

/** Configuração validada e copiada. Objeto congelado. */
export interface Model {
  /** Ids das finalidades, na ordem da configuração. */
  readonly ids: readonly string[];
  /** Posição de cada id em `ids`. */
  readonly positions: ReadonlyMap<string, number>;
  /** Versão configurada de cada finalidade, alinhada a `ids`; `undefined` quando não versionada. */
  readonly versions: readonly (string | undefined)[];
  /** Se `grantAll` alcança cada finalidade, alinhado a `ids` (sem `individualGrant: true`). */
  readonly grantable: readonly boolean[];
  /** Cópia pública e congelada da configuração. */
  readonly purposes: Readonly<Record<string, PurposeConfig>>;
  /** Relógio definido na criação, chamado sem `this`. */
  readonly now: () => unknown;
}

/** Resultado de {@link parseOptions}. */
export interface ParsedOptions {
  readonly model: Model;
  /** Valor lido de `options.record`. Fica fora do modelo para não reter o objeto recebido. */
  readonly record: unknown;
}

const OPTION_KEYS: readonly string[] = ['purposes', 'record', 'now'];
const PURPOSE_KEYS: readonly string[] = ['version', 'category', 'individualGrant'];

/**
 * Valida `options` em ordem fixa, que define o erro lançado quando há mais de um problema, e
 * copia a configuração. Só as chaves de `Object.keys` são consideradas, e cada valor é lido uma
 * única vez.
 */
export function parseOptions(options: unknown): ParsedOptions {
  if (!isPlainObject(options)) {
    throw new TypeError(
      `[lgpder] As opções devem ser um objeto simples; recebido: ${describe(options)}.`,
    );
  }
  const keys = Object.keys(options);
  const unknownOption = findUnknownKey(keys, OPTION_KEYS);
  if (unknownOption !== undefined) {
    throw new TypeError(`[lgpder] Opção desconhecida: ${JSON.stringify(unknownOption)}.`);
  }

  const purposes = readOwn(options, keys, 'purposes');
  if (!isPlainObject(purposes)) {
    throw new TypeError(
      `[lgpder] "purposes" deve ser um objeto simples; recebido: ${describe(purposes)}.`,
    );
  }
  const ids = Object.keys(purposes);
  if (ids.length === 0) {
    throw new TypeError('[lgpder] "purposes" deve declarar ao menos uma finalidade.');
  }
  const positions = new Map<string, number>();
  const versions: (string | undefined)[] = [];
  const grantable: boolean[] = [];
  const copies: Record<string, PurposeConfig> = {};
  for (const [index, id] of ids.entries()) {
    // O id é validado antes de o valor ser lido, para que um id inválido nunca acione um getter.
    if (!isValidId(id)) {
      throw new TypeError(`[lgpder] Identificador de finalidade inválido: ${JSON.stringify(id)}.`);
    }
    const purpose = parsePurpose(id, purposes[id]);
    positions.set(id, index);
    versions.push(purpose.version);
    grantable.push(purpose.grantable);
    copies[id] = purpose.config;
  }

  const now = readOwn(options, keys, 'now');
  if (now !== undefined && !isFunction(now)) {
    throw new TypeError(`[lgpder] "now" deve ser uma função; recebido: ${describe(now)}.`);
  }

  const model: Model = {
    ids: Object.freeze(ids),
    positions,
    versions: Object.freeze(versions),
    grantable: Object.freeze(grantable),
    purposes: Object.freeze(copies),
    // O relógio padrão é lido na criação, e não na importação do módulo: vale o Date.now vigente
    // quando o gerenciador é criado.
    now: now ?? Date.now,
  };
  return { model: Object.freeze(model), record: readRecordOption(options, keys) };
}

/** Finalidade validada: a cópia pública e os dados que o modelo usa. */
interface ParsedPurpose {
  /** Cópia congelada. */
  readonly config: PurposeConfig;
  readonly version: string | undefined;
  /** Se `grantAll` alcança a finalidade. */
  readonly grantable: boolean;
}

/**
 * Valida a configuração de uma finalidade. A cópia tem somente as propriedades informadas com
 * valor diferente de `undefined`, na ordem `version`, `category`, `individualGrant`. O modelo usa
 * os valores validados, e não a cópia: ler dela uma propriedade ausente consultaria o protótipo,
 * que pode estar poluído.
 */
function parsePurpose(id: string, value: unknown): ParsedPurpose {
  if (!isPlainObject(value)) {
    throw new TypeError(
      `[lgpder] A configuração da finalidade ${JSON.stringify(id)} deve ser um objeto simples; recebido: ${describe(value)}.`,
    );
  }
  const keys = Object.keys(value);
  const unknownKey = findUnknownKey(keys, PURPOSE_KEYS);
  if (unknownKey !== undefined) {
    throw new TypeError(
      `[lgpder] A finalidade ${JSON.stringify(id)} tem a propriedade desconhecida ${JSON.stringify(unknownKey)}.`,
    );
  }
  const version = readOwn(value, keys, 'version');
  if (version !== undefined && !isVersion(version)) {
    throw new TypeError(
      `[lgpder] A versão da finalidade ${JSON.stringify(id)} deve ser um texto não vazio.`,
    );
  }
  const category = readOwn(value, keys, 'category');
  if (category !== undefined && !isValidId(category)) {
    throw new TypeError(
      `[lgpder] A categoria da finalidade ${JSON.stringify(id)} deve ser um identificador válido.`,
    );
  }
  const individualGrant = readOwn(value, keys, 'individualGrant');
  if (individualGrant !== undefined && typeof individualGrant !== 'boolean') {
    throw new TypeError(
      `[lgpder] "individualGrant" da finalidade ${JSON.stringify(id)} deve ser booleano.`,
    );
  }

  const copy: { version?: string; category?: string; individualGrant?: boolean } = {};
  if (version !== undefined) copy.version = version;
  if (category !== undefined) copy.category = category;
  if (individualGrant !== undefined) copy.individualGrant = individualGrant;
  return { config: Object.freeze(copy), version, grantable: individualGrant !== true };
}

/** Primeira chave, na ordem de `Object.keys`, que não está em `allowed`. */
function findUnknownKey(keys: readonly string[], allowed: readonly string[]): string | undefined {
  return keys.find((key) => !allowed.includes(key));
}

/**
 * Lê `key` somente se ela estiver em `keys`, o resultado de `Object.keys(object)`: propriedade
 * herdada ou não enumerável vale `undefined` e não é lida.
 */
function readOwn(object: PlainObject, keys: readonly string[], key: string): unknown {
  return keys.includes(key) ? object[key] : undefined;
}

/**
 * Lê `options.record`. Se a leitura lançar, a exceção é descartada e vale registro vazio: o
 * registro é dado não confiável e nunca impede a criação.
 */
function readRecordOption(options: PlainObject, keys: readonly string[]): unknown {
  try {
    return readOwn(options, keys, 'record');
  } catch {
    return undefined;
  }
}
