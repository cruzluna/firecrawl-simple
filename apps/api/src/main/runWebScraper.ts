import { Job } from "bullmq";
import {
  WebScraperOptions,
  RunWebScraperParams,
  RunWebScraperResult,
} from "../types";
import { WebScraperDataProvider } from "../scraper/WebScraper";
import { Progress } from "../lib/entities";
import { Document } from "../lib/entities";
import { Logger } from "../lib/logger";
import { configDotenv } from "dotenv";
configDotenv();

export async function startWebScraperPipeline({
  job,
  token,
}: {
  job: Job<WebScraperOptions>;
  token: string;
}) {
  let partialDocs: Document[] = [];
  return (await runWebScraper({
    url: job.data.url,
    mode: job.data.mode,
    crawlerOptions: job.data.crawlerOptions,
    pageOptions: {
      ...job.data.pageOptions,
      ...(job.data.crawl_id
        ? {
            includeRawHtml: true,
          }
        : {}),
    },
    webhookUrl: job.data.webhookUrl,
    webhookMetadata: job.data.webhookMetadata,
    inProgress: (progress) => {
      Logger.debug(`🐂 Job in progress ${job.id}`);
      if (progress.currentDocument) {
        partialDocs.push(progress.currentDocument);
        if (partialDocs.length > 50) {
          partialDocs = partialDocs.slice(-50);
        }
        // job.updateProgress({ ...progress, partialDocs: partialDocs });
      }
    },
    onSuccess: (result, mode) => {
      Logger.debug(`🐂 Job completed ${job.id}`);
    },
    onError: (error) => {
      Logger.error(`🐂 Job failed ${job.id}`);
      job.moveToFailed(error, token, false);
    },
    team_id: job.data.team_id,
    bull_job_id: job.id.toString(),
    priority: job.opts.priority,
    is_scrape: job.data.is_scrape ?? false,
  })) as { success: boolean; message: string; docs: Document[] };
}
export async function runWebScraper({
  url,
  mode,
  crawlerOptions,
  pageOptions,
  webhookUrl,
  webhookMetadata,
  inProgress,
  onSuccess,
  onError,
  team_id,
  bull_job_id,
  priority,
  is_scrape = false,
}: RunWebScraperParams): Promise<RunWebScraperResult> {
  try {
    const provider = new WebScraperDataProvider();
    if (mode === "crawl") {
      await provider.setOptions({
        jobId: bull_job_id,
        mode: mode,
        urls: [url],
        crawlerOptions: crawlerOptions,
        pageOptions: pageOptions,
        bullJobId: bull_job_id,
        priority,
      });
    } else {
      await provider.setOptions({
        jobId: bull_job_id,
        mode: mode,
        urls: url.split(","),
        crawlerOptions: crawlerOptions,
        pageOptions: pageOptions,
        webhookUrl: webhookUrl,
        webhookMetadata: webhookMetadata,
        teamId: team_id,
      });
    }
    const docs = (await provider.getDocuments(false, (progress: Progress) => {
      inProgress(progress);
    })) as Document[];

    if (docs.length === 0) {
      return {
        success: true,
        message: "No pages found",
        docs: [],
      };
    }

    // remove docs with empty content
    const filteredDocs = crawlerOptions.returnOnlyUrls
      ? docs.map((doc) => {
          if (doc.metadata.sourceURL) {
            return { url: doc.metadata.sourceURL };
          }
        })
      : docs;

    // This is where the returnvalue from the job is set
    onSuccess(filteredDocs, mode);

    // this return doesn't matter too much for the job completion result
    return { success: true, message: "", docs: filteredDocs };
  } catch (error) {
    onError(error);
    return { success: false, message: error.message, docs: [] };
  }
}
