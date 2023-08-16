import { TextEncoder } from "util";
import { AstNode, AstType } from "./parser.js";

function exhaustive(x: never): never {
    throw new Error(`Expected all cases to be handled, but got ${x} instead`);
}

function encode_string(str: string): [number, string] {
    const encoder = new TextEncoder();
    const enc = [...encoder.encode(str)];
    const enc_str = enc.map(code => {
        let hex = code.toString(16)
        if (hex.length === 1) { hex = '0' + hex; }
        return '\\' + hex;
    }).join('');
    return [enc.length + 1, enc_str + '\\00'];
}

function varName(name: string) {
    return `@var_${name}`;
}

function astEqual(a: AstNode['value'], b: AstNode['value']) {
    if (typeof a !== typeof b) { return false; }
    if (!(a instanceof Array && b instanceof Array)) { return a === b; }
    if (a.length !== b.length) { return false; }

    for (let i = 0; i < a.length; i++) {
        if (a[i].type !== b[i].type) {
            return false
        }

        return astEqual(a[i].value, b[i].value);
    }

    return true;
}

class TemporaryGenerator {
    #id: number = 1;
    #template: (id: number) => string
    constructor(template: string | ((id: number) => string)) {
        if (typeof template === 'string') {
            this.#template = id => template + id.toString();
        }
        else {
            this.#template = template;
        }
    }
    next() {
        return this.#template(this.#id++);
    }
}

function definePush(name: string, type: string) {
    return `
define void ${name}(${type} %value) {
entry:
  %stack_size = load i64, i64* @stack_size
  %stack_capacity0 = load i64, i64* @stack_capacity
  %cond = icmp eq i64 %stack_size, %stack_capacity0
  br i1 %cond, label %increase_capacity, label %set_value
  
increase_capacity:
  %buffer0 = load ptr, ptr @stack
  %new_capacity = shl i64 %stack_capacity0, 1
  %new_buffer_size = mul i64 %new_capacity, 8
  %new_buffer = call ptr @realloc(ptr %buffer0, i64 %new_buffer_size)
  store ptr %new_buffer, ptr @stack
  store i64 %new_capacity, i64* @stack_capacity
  br label %set_value

set_value:
  %buffer1 = load ptr, ptr @stack
  %top = getelementptr %union.FalseValue, %union.FalseValue* %buffer1, i64 %stack_size
  %cast = bitcast %union.FalseValue* %top to ${type}*
  store ${type} %value, ${type}* %cast
  %new_size = add i64 %stack_size, 1
  store i64 %new_size, i64* @stack_size
  ret void
}`
}

function definePop(name: string, type: string) {
    return `
define ${type} ${name}() {
entry:
  %stack_size = load i64, i64* @stack_size
  %new_size = sub i64 %stack_size, 1
  store i64 %new_size, i64* @stack_size
  %buffer = load ptr, ptr @stack
  %top = getelementptr %union.FalseValue, ptr %buffer, i64 %new_size
  %cast = bitcast %union.FalseValue* %top to ${type}*
  %value = load ${type}, ptr %cast
  ret ${type} %value
}`
}

function definePeek(name: string, type: string) {
    return `
define ${type} ${name}(i32 %depth) {
entry:
  %stack_size = load i64, i64* @stack_size
  %0 = sext i32 %depth to i64
  %1 = sub i64 %stack_size, %0
  %peek_size = sub i64 %1, 1
  %buffer = load ptr, ptr @stack
  %top = getelementptr %union.FalseValue, ptr %buffer, i64 %peek_size
  %cast = bitcast %union.FalseValue* %top to ${type}*
  %value = load ${type}, ptr %cast
  ret ${type} %value
}`
}

const head = `
@.fmt = private unnamed_addr constant [3 x i8] c"%s\\00"
@.num = private unnamed_addr constant [3 x i8] c"%d\\00"

declare ptr @malloc(i64)
declare ptr @realloc(ptr, i64)
declare void @free(ptr)
declare i32 @putchar(i32)
declare i32 @getchar()
declare i32 @printf(i8*, ...)

%union.FalseValue = type { [8 x i8] }

@stack = global %union.FalseValue* null
@stack_size = global i64 0
@stack_capacity = global i64 0

define void @stack_init() {
entry:
  store i64 16, i64* @stack_capacity
  %stack_capacity = load i64, i64* @stack_capacity
  %buffer_size = mul i64 %stack_capacity, 8
  %buffer = call ptr @malloc(i64 %buffer_size)
  store i64 0, i64* @stack_size
  store ptr %buffer, %union.FalseValue** @stack
  ret void
}

${definePush('@stack_push_any', '%union.FalseValue')}
${definePush('@stack_push_int', 'i32')}
${definePush('@stack_push_ref', '%union.FalseValue*')}
${definePush('@stack_push_quote', 'void()*')}

${definePop('@stack_pop_any', '%union.FalseValue')}
${definePop('@stack_pop_int', 'i32')}
${definePop('@stack_pop_ref', '%union.FalseValue*')}
${definePop('@stack_pop_quote', 'void()*')}

${definePeek('@stack_peek_any', '%union.FalseValue')}
${definePeek('@stack_peek_int', 'i32')}
${definePeek('@stack_peek_ref', '%union.FalseValue*')}
${definePeek('@stack_peek_quote', 'void()*')}

define void @stack_free() {
entry:
  %buffer = load ptr, ptr @stack
  call void @free(ptr %buffer)
  ret void
}

${[...'abcdefghijklmnopqrstuvwxyz']
        .map(a => `${varName(a)} = private global %union.FalseValue { [8 x i8] zeroinitializer }`)
        .join('\n')}
`

class Compiler {

    #functions: [nodes: AstNode[], name: string, compiled: string][] = []
    #strings: Map<string, string> = new Map();

    #compile(nodes: AstNode[]): string {
        const temporaryGenerator = new TemporaryGenerator('%t');
        const labelGenerator = new TemporaryGenerator('label_');

        const instructions: string[] = [];

        function basicOp(op: string): void {
            const second = temporaryGenerator.next();
            const first = temporaryGenerator.next();
            const result = temporaryGenerator.next();
            instructions.push(
                `${second} = call i32 @stack_pop_int()`,
                `${first} = call i32 @stack_pop_int()`,
                `${result} = ${op} i32 ${first}, ${second}`,
                `call void @stack_push_int(i32 ${result})`);
        }

        function cmp(op: string): void {
            const second = temporaryGenerator.next();
            const first = temporaryGenerator.next();
            const result = temporaryGenerator.next();
            const cast = temporaryGenerator.next();
            instructions.push(
                `${second} = call i32 @stack_pop_int()`,
                `${first} = call i32 @stack_pop_int()`,
                `${result} = icmp ${op} i32 ${first}, ${second}`,
                `${cast} = sext i1 ${result} to i32`,
                `call void @stack_push_int(i32 ${cast})`);
        }

        for (const node of nodes) {
            switch (node.type) {
                case AstType.Variable:
                    instructions.push(`call void @stack_push_ref(%union.FalseValue* ${varName(node.value)})`);
                    break;
                case AstType.String: {
                    const strName = this.#getConstString(node.value);
                    instructions.push(`call i32 @printf(i8* @.fmt, i8* ${strName})`);
                    break;
                }

                case AstType.Integer:
                    instructions.push(`call void @stack_push_int(i32 ${node.value})`);
                    break;
                case AstType.Quote: {
                    const name = this.#getFunction(node.value);
                    instructions.push(`call void @stack_push_quote(void()* ${name})`);
                    break;
                }

                case AstType.GetVar: {
                    const varRef = temporaryGenerator.next();
                    const value = temporaryGenerator.next();
                    instructions.push(
                        `${varRef} = call %union.FalseValue* @stack_pop_ref()`,
                        `${value} = load %union.FalseValue, %union.FalseValue* ${varRef}`,
                        `call void @stack_push_any(%union.FalseValue ${value})`);
                    break;
                }

                case AstType.SetVar: {
                    const varRef = temporaryGenerator.next();
                    const value = temporaryGenerator.next();
                    instructions.push(
                        `${varRef} = call %union.FalseValue* @stack_pop_ref()`,
                        `${value} = call %union.FalseValue @stack_pop_any()`,
                        `store %union.FalseValue ${value}, %union.FalseValue* ${varRef}`);
                    break;
                }

                case AstType.Dup: {
                    const value = temporaryGenerator.next();
                    instructions.push(
                        `${value} = call %union.FalseValue @stack_peek_any(i32 0)`,
                        `call void @stack_push_any(%union.FalseValue ${value})`);
                    break;
                }

                case AstType.Discard:
                    instructions.push(`call %union.FalseValue @stack_pop_any()`);
                    break;
                case AstType.Swap: {
                    const first = temporaryGenerator.next();
                    const second = temporaryGenerator.next();
                    instructions.push(
                        `${first} = call %union.FalseValue @stack_pop_any()`,
                        `${second} = call %union.FalseValue @stack_pop_any()`,
                        `call void @stack_push_any(%union.FalseValue ${first})`,
                        `call void @stack_push_any(%union.FalseValue ${second})`);
                    break;
                }

                case AstType.Rotate: {
                    const first = temporaryGenerator.next();
                    const second = temporaryGenerator.next();
                    const third = temporaryGenerator.next();
                    instructions.push(
                        `${first} = call %union.FalseValue @stack_pop_any()`,
                        `${second} = call %union.FalseValue @stack_pop_any()`,
                        `${third} = call %union.FalseValue @stack_pop_any()`,
                        `call void @stack_push_any(%union.FalseValue ${second})`,
                        `call void @stack_push_any(%union.FalseValue ${first})`,
                        `call void @stack_push_any(%union.FalseValue ${third})`);
                    break;
                }

                case AstType.Take: {
                    const depth = temporaryGenerator.next();
                    const value = temporaryGenerator.next();
                    instructions.push(
                        `${depth} = call i32 @stack_pop_int()`,
                        `${value} = call %union.FalseValue @stack_peek_any(i32 ${depth})`,
                        `call void @stack_push_any(%union.FalseValue ${value})`);
                    break;
                }

                case AstType.Plus: basicOp('add'); break;
                case AstType.Minus: basicOp('sub'); break;
                case AstType.Mul: basicOp('mul'); break;
                case AstType.Div: basicOp('sdiv'); break;
                case AstType.Negate: {
                    const value = temporaryGenerator.next();
                    const temp = temporaryGenerator.next();
                    instructions.push(
                        `${value} = call i32 @stack_pop_int()`,
                        `${temp} = sub i32 0, ${value}`,
                        `call void @stack_push_int(i32 ${temp})`);
                    break;
                }

                case AstType.BitAnd: basicOp('and'); break;
                case AstType.BitOr: basicOp('or'); break;
                case AstType.BitInvert: {
                    const value = temporaryGenerator.next();
                    const temp = temporaryGenerator.next();
                    instructions.push(
                        `${value} = call i32 @stack_pop_int()`,
                        `${temp} = xor i32 -1, ${value}`,
                        `call void @stack_push_int(i32 ${temp})`);
                    break;
                }

                case AstType.Equal: cmp('eq'); break;
                case AstType.GreaterThan: cmp('sgt'); break;
                case AstType.Execute: {
                    const value = temporaryGenerator.next();
                    instructions.push(
                        `${value} = call void()* @stack_pop_quote()`,
                        `call void ${value}()`);
                    break;
                }

                case AstType.ExecuteIf: {
                    const iftrue = labelGenerator.next();
                    const iffalse = labelGenerator.next();
                    const quote = temporaryGenerator.next();
                    const value = temporaryGenerator.next();
                    const cond = temporaryGenerator.next();

                    instructions.push(
                        `${quote} = call void()* @stack_pop_quote()`,
                        `${value} = call i32 @stack_pop_int()`,
                        `${cond} = icmp ne i32 ${value}, 0`,
                        `br i1 ${cond}, label %${iftrue}, label %${iffalse}`,
                        `${iftrue}:`,
                        `call void ${quote}()`,
                        `br label %${iffalse}`,
                        `${iffalse}:`);
                    break;
                }

                case AstType.While: {
                    const loop = labelGenerator.next();
                    const iftrue = labelGenerator.next();
                    const iffalse = labelGenerator.next();
                    const body = temporaryGenerator.next();
                    const cond_quote = temporaryGenerator.next();
                    const value = temporaryGenerator.next();
                    const cond = temporaryGenerator.next();

                    instructions.push(
                        `${body} = call void()* @stack_pop_quote()`,
                        `${cond_quote} = call void()* @stack_pop_quote()`,
                        `br label %${loop}`,
                        `${loop}:`,
                        `call void ${cond_quote}()`,
                        `${value} = call i32 @stack_pop_int()`,
                        `${cond} = icmp ne i32 ${value}, 0`,
                        `br i1 ${cond}, label %${iftrue}, label %${iffalse}`,
                        `${iftrue}:`,
                        `call void ${body}()`,
                        `br label %${loop}`,
                        `${iffalse}:`);
                    break;
                }

                case AstType.Getc: {
                    const temp = temporaryGenerator.next();
                    instructions.push(
                        `${temp} = call i32 @getchar()`,
                        `call void @stack_push_int(i32 ${temp})`);
                    break;
                }

                case AstType.Putc: {
                    const temp = temporaryGenerator.next();
                    instructions.push(
                        `${temp} = call i32 @stack_pop_int()`,
                        `call i32 @putchar(i32 ${temp})`);
                    break;
                }

                case AstType.PrintInt: {
                    const temp = temporaryGenerator.next();
                    instructions.push(
                        `${temp} = call i32 @stack_pop_int()`,
                        `call i32 @printf(i8* @.num, i32 ${temp})`);
                    break;
                }

                default:
                    exhaustive(node);
            }
        }
        return instructions.join('\n');
    }

    compile(ast: AstNode[]) {
        const topLevel = this.#compile(ast);

        const strings = [...this.#strings.entries()]
            .map(([str, name]) => {
                const [len, enc] = encode_string(str);
                return `${name} = private unnamed_addr constant [${len} x i8] c"${enc}"`
            });

        return head + [
            ...strings,
            ...this.#functions.map(x => x[2]),
            'define i32 @main() {',
            'call void @stack_init()',
            topLevel,
            'call void @stack_free()',
            'ret i32 0',
            '}',
        ].join('\n');
    }

    #lambdaNameGenerator = new TemporaryGenerator('@lambda_');
    #stringNameGenerator = new TemporaryGenerator('@str_');

    #getFunction(nodes: AstNode[]) {
        const name = this.#functions.find(([value]) => astEqual(nodes, value))?.[1];
        if (name) {
            return name;
        }
        else {
            const name = this.#lambdaNameGenerator.next();
            const compiled = `define void ${name}() {\nentry:\n${this.#compile(nodes)}\nret void\n}`;
            this.#functions.push([nodes, name, compiled]);
            return name;
        }
    }

    #getConstString(str: string) {
        const name = this.#strings.get(str);
        if (name) {
            return name;
        }
        else {
            const name = this.#stringNameGenerator.next();
            this.#strings.set(str, name);
            return name;
        }
    }
}

export function compile(source: AstNode[]): string {
    return new Compiler().compile(source);
}
