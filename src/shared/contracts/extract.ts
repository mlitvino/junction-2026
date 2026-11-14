import { z } from "zod";

/** POST /api/extract — request body */
export const ExtractRequestSchema = z.object({
  prompt: z.string().trim().min(1).meta({
    description: "Free-form natural-language purchasing request from the user.",
    example: "I want to buy 420 kg of creamy cheese",
  }),
});

export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;

/** Single extracted product item from a prompt */
export const ExtractedProductItemSchema = z.object({
  productName: z.string().meta({
    description: "Specific product name or descriptor requested by the user.",
    example: "Creamy cheese",
  }),
  productType: z.string().meta({
    description: "General product category or type.",
    example: "Cheese",
  }),
  productQuantity: z.string().meta({
    description: "Requested quantity with unit (or 'unspecified' if not stated).",
    example: "420 kg",
  }),
});

export type ExtractedProductItem = z.infer<typeof ExtractedProductItemSchema>;

/** POST /api/extract — response body */
export const ExtractResponseSchema = z.object({
  items: z.array(ExtractedProductItemSchema).meta({
    description: "List of extracted product items from the prompt.",
  }),
});

export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;
