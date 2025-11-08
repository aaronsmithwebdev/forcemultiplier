import axios, { AxiosInstance } from "axios";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { SALESFORCE_USER_COOKIE, getCurrentUserId } from "@/lib/auth";
import type { SalesforceReportPreview, SalesforceReportSummary } from "@/types/salesforce";

const API_VERSION = process.env.SALESFORCE_API_VERSION ?? "v60.0";
const LOGIN_BASE_URL = process.env.SALESFORCE_LOGIN_BASE_URL ?? "https://login.salesforce.com";

/**
 * Tiny wrapper around axios that injects the Salesforce access token and refreshes it automatically
 * if we receive a 401 response. All API route handlers should call `ensureSalesforceClient()` instead
 * of constructing the class manually to guarantee that the cookie + database lookup happens correctly.
 */
export class SalesforceClient {
  private axios: AxiosInstance;

  constructor(private token: { accessToken: string; refreshToken: string; instanceUrl: string; userId: string }) {
    this.axios = axios.create({
      baseURL: token.instanceUrl,
      headers: {
        Authorization: `Bearer ${token.accessToken}`
      }
    });

    this.axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          const refreshed = await refreshAccessToken(token.userId, token.refreshToken);
          if (refreshed) {
            this.axios.defaults.headers.common.Authorization = `Bearer ${refreshed.accessToken}`;
            error.config.headers.Authorization = `Bearer ${refreshed.accessToken}`;
            return this.axios.request(error.config);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async listReports(params: { search?: string; folder?: string }): Promise<SalesforceReportSummary[]> {
    const response = await this.axios.get(`/services/data/${API_VERSION}/analytics/reports`, {
      params: {
        filter: params.folder,
        q: params.search
      }
    });

    return (response.data?.reports ?? []).map((report: any) => ({
      id: report.id,
      name: report.name,
      folderName: report.folderName,
      lastModifiedDate: report.lastModifiedDate
    }));
  }

  async getReport(reportId: string): Promise<SalesforceReportPreview> {
    const response = await this.axios.get(`/services/data/${API_VERSION}/analytics/reports/${reportId}`);
    const data = response.data;

    const fields = (data.reportMetadata?.detailColumns ?? []).map((fieldName: string) => {
      const column = data.reportExtendedMetadata?.detailColumnInfo?.[fieldName];
      return {
        fieldName,
        label: column?.label ?? fieldName
      };
    });

    const rows =
      data.factMap?.["T!T"]?.rows?.map((row: any) => {
        const record: Record<string, string | number | null> = {};
        fields.forEach((field: { fieldName: string }) => {
          const dataCell = row.dataCells?.find((cell: any) => cell.column === field.fieldName);
          record[field.fieldName] = dataCell?.label ?? null;
        });
        return record;
      }) ?? [];

    return {
      fields,
      rows,
      reportName: data.reportMetadata?.reportName ?? "Report"
    };
  }

  async fetchReportRecords(reportId: string) {
    const preview = await this.getReport(reportId);
    return preview.rows;
  }
}

export async function createSalesforceClient() {
  const cookieStore = cookies();
  const userId = cookieStore.get(SALESFORCE_USER_COOKIE)?.value;
  if (!userId) return null;

  const token = await prisma.salesforceToken.findUnique({ where: { userId } });
  if (!token) return null;

  return new SalesforceClient({
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    instanceUrl: token.instanceUrl,
    userId: token.userId
  });
}

export async function refreshAccessToken(userId: string, refreshToken: string) {
  try {
    const response = await axios.post(
      `${LOGIN_BASE_URL}/services/oauth2/token`,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.SALESFORCE_CLIENT_ID ?? "",
        client_secret: process.env.SALESFORCE_CLIENT_SECRET ?? ""
      })
    );

    const { access_token: accessToken, instance_url: instanceUrl } = response.data;

    const existing = await prisma.salesforceToken.findUnique({ where: { userId } });

    await prisma.salesforceToken.update({
      where: { userId },
      data: {
        accessToken,
        instanceUrl: instanceUrl ?? existing?.instanceUrl ?? "",
        issuedAt: new Date()
      }
    });

    return { accessToken };
  } catch (error) {
    console.error("Failed to refresh Salesforce token", error);
    return null;
  }
}

export async function ensureSalesforceClient() {
  const client = await createSalesforceClient();
  if (!client) {
    throw new Error("Salesforce connection not found");
  }
  return client;
}

export async function getSalesforceIdentity() {
  const token = await prisma.salesforceToken.findUnique({ where: { userId: getCurrentUserId() ?? "" } });
  if (!token) return null;

  try {
    const response = await axios.get(`${token.instanceUrl}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${token.accessToken}` }
    });
    return {
      orgName: response.data?.organization_name ?? "Unknown org",
      userName: response.data?.preferred_username ?? response.data?.email
    };
  } catch (error) {
    console.error("Failed to fetch Salesforce identity", error);
    return null;
  }
}
