import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "android/.gradle/**",
      "android/app/build/**",
      "android/app/src/main/assets/**",
      "android/build/**",
      "node_modules/**",
      "next-env.d.ts",
      "coverage/**",
      "dist/**",
      "out/**"
    ]
  }
];

export default eslintConfig;
