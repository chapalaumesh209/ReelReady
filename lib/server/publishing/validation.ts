import { GenerationError } from "../../generation";
import type { PublishInput } from "../../workflow";
import { xCount, hasLinks } from "../../content";
export function validatePublish(data: PublishInput) {
  if (data.platforms.includes("x") && hasLinks(data.x))
    throw new GenerationError(
      "Remove links from the X post before publishing.",
      400,
    );
  if (new Set(data.platforms).size !== data.platforms.length)
    throw new GenerationError("Select each platform only once.", 400);
  if (data.platforms.includes("youtube") && !data.youtubeTitle.trim())
    throw new GenerationError("Add a YouTube title before publishing.", 400);
  if (
    (data.platforms.includes("instagram") && !data.instagram.trim()) ||
    (data.platforms.includes("x") && !data.x.trim())
  )
    throw new GenerationError(
      "Add the caption for each selected platform.",
      400,
    );
  if (data.platforms.includes("x") && xCount(data.x) > 280)
    throw new GenerationError(
      "For X, keep text within 280 weighted characters.",
      400,
    );
  if (data.scheduledAt) {
    const delta = Date.parse(data.scheduledAt) - Date.now();
    if (delta < 5 * 60000 || delta > 365 * 86400000)
      throw new GenerationError(
        "Choose a scheduled time at least 5 minutes ahead and within a year, or publish now.",
        400,
      );
  }
}
