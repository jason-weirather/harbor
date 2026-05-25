import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

const toyPlacement = z.enum([
  "sidecar",
  "below-intro",
  "card-after-intro",
  "inline",
  "hero",
  "room",
  "ambient",
]);

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    authorName: z.string(),
    publishedAt: z.coerce.date(),
    heroTag: z.string(),
    pond: z
      .object({
        roomUrl: z.string(),
        placement: z.object({
          desktop: toyPlacement,
          mobile: toyPlacement,
        }),
      })
      .optional(),
  }),
});

const artifacts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/artifacts" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    type: z.enum([
      "mini_post",
      "response",
      "comment",
      "external_link",
      "quote",
      "demo_note",
    ]),
    authorName: z.string(),
    authorId: z.string(),
    published: z.boolean().default(true),
    pondEligible: z.boolean().default(true),
    pointsBonus: z.number().optional(),
    disclosure: z.string().optional(),
    external: z.boolean().default(false),
  }),
});

export const collections = {
  posts,
  artifacts,
};

