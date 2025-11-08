export type SalesforceReportSummary = {
  id: string;
  name: string;
  folderName: string;
  lastModifiedDate: string;
};

export type SalesforceReportField = {
  label: string;
  fieldName: string;
};

export type SalesforceReportRow = Record<string, string | number | null>;

export type SalesforceReportPreview = {
  fields: SalesforceReportField[];
  rows: SalesforceReportRow[];
  reportName: string;
};
