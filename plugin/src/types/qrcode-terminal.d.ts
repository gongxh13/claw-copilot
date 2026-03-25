declare module 'qrcode-terminal' {
  function generate(text: string, callback?: (error: Error | null, qrcode: string) => void): void;
  function generate(text: string, options?: object, callback?: (error: Error | null, qrcode: string) => void): void;
  export = { generate };
}