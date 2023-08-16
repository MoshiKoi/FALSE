import { Token, TokenType, Tokenizer } from "./tokenizer.js"

export enum AstType {
	Variable,
	String,
	Integer, // Including chars such as 'A
	Quote,
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
}

type ValueAst =
	| { type: AstType.Variable, value: string }
	| { type: AstType.String, value: string }
	| { type: AstType.Integer, value: number }
	| { type: AstType.Quote, value: AstNode[] }

type NonValueAst = { type: Exclude<AstType, ValueAst['type']>, value: undefined }

export type AstNode = ValueAst | NonValueAst

class Parser {
	#tokenizer: Iterator<Token>
	#currentToken: Token | null = null

	constructor(tokenizer: Iterator<Token>) {
		this.#tokenizer = tokenizer;
		this.#next();
	}

	parseStatements(): AstNode[] {
		const statements: AstNode[] = [];

		const _this = this;
		function instr<const T extends ValueAst>(type: T['type'], value: T['value']): void;
		function instr<const T extends NonValueAst>(type: T['type']): void;
		function instr(type: any, value?: any): void {
			statements.push({ type, value });
			_this.#next();
		}

		loop:
		while (this.#currentToken) {
			switch (this.#currentToken.type) {
				case TokenType.Variable: instr(AstType.Variable, this.#currentToken.value); break;
				case TokenType.String: instr(AstType.String, this.#currentToken.value); break
				case TokenType.Integer: instr(AstType.Integer, this.#currentToken.value); break;
				case TokenType.OpenBracket: this.#next(); instr(AstType.Quote, this.parseStatements()); break;
				case TokenType.CloseBracket: break loop;
				case TokenType.GetVar: instr(AstType.GetVar); break;
				case TokenType.SetVar: instr(AstType.SetVar); break;
				case TokenType.Dup: instr(AstType.Dup); break;
				case TokenType.Discard: instr(AstType.Discard); break;
				case TokenType.Swap: instr(AstType.Swap); break;
				case TokenType.Rotate: instr(AstType.Rotate); break;
				case TokenType.Take: instr(AstType.Take); break;
				case TokenType.Plus: instr(AstType.Plus); break;
				case TokenType.Minus: instr(AstType.Minus); break;
				case TokenType.Mul: instr(AstType.Mul); break;
				case TokenType.Div: instr(AstType.Div); break;
				case TokenType.Negate: instr(AstType.Negate); break;
				case TokenType.BitAnd: instr(AstType.BitAnd); break;
				case TokenType.BitOr: instr(AstType.BitOr); break;
				case TokenType.BitInvert: instr(AstType.BitInvert); break;
				case TokenType.Equal: instr(AstType.Equal); break;
				case TokenType.GreaterThan: instr(AstType.GreaterThan); break;
				case TokenType.Execute: instr(AstType.Execute); break;
				case TokenType.ExecuteIf: instr(AstType.ExecuteIf); break;
				case TokenType.While: instr(AstType.While); break;
				case TokenType.Getc: instr(AstType.Getc); break;
				case TokenType.Putc: instr(AstType.Putc); break;
				case TokenType.PrintInt: instr(AstType.PrintInt); break;
				case TokenType.Flush: this.#next(); break; // no-op
				case TokenType.Asm:
					this.#next();
					// @ts-ignore https://github.com/Microsoft/TypeScript/issues/9998
					if (this.#currentToken.type === TokenType.Integer) {
						this.#next();
						throw new Error(`Assembly is not supported`);
					}
					else {
						throw new Error(`Syntax error: Expected a short`);
					}
			}
		}

		return statements;
	}

	#next() {
		const { value, done } = this.#tokenizer.next();
		this.#currentToken = done ? null : value;
	}
}

export function parse(source: string) {
	const tokenizer = new Tokenizer(source);
	const parser = new Parser(tokenizer);
	return parser.parseStatements();
}
