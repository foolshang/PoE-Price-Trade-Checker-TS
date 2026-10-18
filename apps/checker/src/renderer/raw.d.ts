/** a text file imported with ?raw (the CHANGELOG.md that is built into the program) */
declare module "*.md?raw" {
  const text: string;
  export default text;
}
