export enum TokenType {
	Variable,
	String,
	Integer, // Including chars such as 'A
	OpenBracket,
	CloseBracket,
	GetVar,
	SetVar,
	Dup,
	Discard,
	Swap,
	Rotate,
	Take,
	Plus,
	Minus,
	Mul,
	Div,
	Negate,
	BitAnd,
	BitOr,
	BitInvert,
	Equal,
	GreaterThan,
	Execute,
	ExecuteIf,
	While,
	Getc,
	Putc,
	PrintInt,
	Flush,
	Asm,
}

type ValueToken =
	| { type: TokenType.Variable, value: string }
	| { type: TokenType.String, value: string }
	| { type: TokenType.Integer, value: number }

type NonValueToken = { type: Exclude<TokenType, ValueToken['type']> }

export type Token = ValueToken | NonValueToken

export class Tokenizer implements Iterable<Token>, Iterator<Token, null>{
	static readonly symbols: ReadonlyMap<string, NonValueToken> =
		new Map<string, NonValueToken>(([
			['[', TokenType.OpenBracket],
			[']', TokenType.CloseBracket],
			[';', TokenType.GetVar],
			[':', TokenType.SetVar],
			['$', TokenType.Dup],
			['%', TokenType.Discard],
			['\\', TokenType.Swap],
			['@', TokenType.Rotate],
			['O', TokenType.Take],
			['+', TokenType.Plus],
			['-', TokenType.Minus],
			['*', TokenType.Mul],
			['/', TokenType.Div],
			['_', TokenType.Negate],
			['&', TokenType.BitAnd],
			['|', TokenType.BitOr],
			['~', TokenType.BitInvert],
			['=', TokenType.Equal],
			['>', TokenType.GreaterThan],
			['!', TokenType.Execute],
			['?', TokenType.ExecuteIf],
			['#', TokenType.While],
			['^', TokenType.Getc],
			[',', TokenType.Putc],
			['.', TokenType.PrintInt],
			['B', TokenType.Flush],
			['`', TokenType.Asm],
		] as const).map(([sym, type]) => [sym, { type }]))

	#source: string;
	#pos: number;

	get #currentChar(): string { return this.#source[this.#pos]; }

	constructor(source: string) {
		this.#source = source;
		this.#pos = 0;
	}

	[Symbol.iterator](): Tokenizer { return this; }

	next(): IteratorResult<Token, null> {
		while (this.#pos < this.#source.length) {
			if (/\s/.test(this.#currentChar)) { ++this.#pos; continue; }
			if (this.#currentChar === '{') { this.#skipComment(); continue; }

			if (this.#currentChar === '\'') { return { value: this.#nextChar() }; }
			if (this.#currentChar === '"') { return { value: this.#nextString() }; }
			if ('0' <= this.#currentChar && this.#currentChar <= '9') { return { value: this.#nextNumber() }; }
			if ('a' <= this.#currentChar && this.#currentChar <= 'z') { return { value: this.#nextVariable() }; }

			const sym = Tokenizer.symbols.get(this.#currentChar);
			if (sym) {
				++this.#pos;
				return { value: sym };
			}

			throw new Error(`Invalid character: ${this.#currentChar}`);
		}
		return { value: null, done: true };
	}

	#nextVariable(): Token {
		const variable = this.#currentChar;
		++this.#pos;
		return {
			type: TokenType.Variable,
			value: variable
		};
	}

	#skipComment(): void {
		while (this.#pos < this.#source.length && this.#currentChar !== '}') {
			++this.#pos;
		}
		this.#eat('}', "Unclosed comment");
	}

	#nextNumber(): Token {
		const start = this.#pos;
		while ('0' <= this.#currentChar && this.#currentChar <= '9') {
			++this.#pos;
		}
		return {
			type: TokenType.Integer,
			value: parseInt(this.#source.substring(start, this.#pos))
		};
	}

	#nextChar(): Token {
		this.#eat('\'');
		if (this.#currentChar) {
			const value = this.#currentChar.charCodeAt(0);
			++this.#pos;
			return { type: TokenType.Integer, value };
		}
		else {
			throw new Error(`Expected a character`);
		}
	}

	#nextString(): Token {
		this.#eat('"');
		const start = this.#pos;
		while (this.#pos < this.#source.length && this.#currentChar !== '"') {
			++this.#pos;
		}
		const result = this.#source.substring(start, this.#pos);
		this.#eat('"');

		return {
			type: TokenType.String,
			value: result
		};
	}

	#eat(char: string, errorMessage?: string): void {
		if (this.#currentChar === char) {
			++this.#pos;
		}
		else {
			throw new Error(errorMessage ?? `Expected ${char}, got ${this.#currentChar} instead`);
		}
	}
}