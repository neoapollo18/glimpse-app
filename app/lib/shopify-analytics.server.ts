/**
 * Shopify Analytics Server Utilities
 * 
 * Uses ShopifyQL via the GraphQL Admin API to fetch store analytics data.
 * Requires the `read_reports` scope.
 */

interface ShopifyQLResponse {
  shopifyqlQuery: {
    tableData?: {
      columns: Array<{ name: string; dataType: string }>;
      rows: Array<string[]>;
    };
    parseErrors?: Array<{ message: string }>;
  };
}

/**
 * Fetches the average monthly sessions for the store based on the last 90 days.
 * 
 * Pulls total sessions from the last 90 days and divides by 3 to get 
 * the average 30-day session count. This provides a more stable metric
 * for billing purposes that isn't affected by short-term fluctuations.
 * 
 * @param admin - The authenticated admin GraphQL client from Shopify
 * @returns The average monthly session count, or null if unable to fetch (permission denied, error, etc.)
 */
export async function getMonthlySessionsCount(
  admin: { graphql: (query: string) => Promise<Response> }
): Promise<number | null> {
  try {
    // Fetch sessions from the last 90 days
    const query = `
      query GetQuarterlySessions {
        shopifyqlQuery(query: "FROM sessions SHOW sessions SINCE -90d") {
          tableData {
            columns {
              name
              dataType
            }
            rows
          }
          parseErrors {
            message
          }
        }
      }
    `;

    const response = await admin.graphql(query);
    const result = await response.json() as { data?: ShopifyQLResponse; errors?: Array<{ message: string }> };

    // Check for GraphQL errors (e.g., permission denied)
    if (result.errors && result.errors.length > 0) {
      console.error('ShopifyQL GraphQL errors:', result.errors);
      return null;
    }

    const shopifyqlData = result.data?.shopifyqlQuery;

    // Check for parse errors in the ShopifyQL query
    if (shopifyqlData?.parseErrors && shopifyqlData.parseErrors.length > 0) {
      console.error('ShopifyQL parse errors:', shopifyqlData.parseErrors);
      return null;
    }

    // Extract sessions count from the response
    const tableData = shopifyqlData?.tableData;
    if (!tableData || !tableData.rows || tableData.rows.length === 0) {
      console.log('No session data returned from ShopifyQL');
      return 0; // No data means 0 sessions
    }

    // Find the sessions column index
    const sessionsColumnIndex = tableData.columns.findIndex(
      (col) => col.name.toLowerCase() === 'sessions'
    );

    if (sessionsColumnIndex === -1) {
      console.error('Sessions column not found in ShopifyQL response');
      return null;
    }

    // Sum up all session values (in case there are multiple rows)
    let totalSessions = 0;
    for (const row of tableData.rows) {
      const sessionValue = row[sessionsColumnIndex];
      const parsedValue = parseInt(sessionValue, 10);
      if (!isNaN(parsedValue)) {
        totalSessions += parsedValue;
      }
    }

    // Calculate average monthly sessions (90 days / 3 = 30 day average)
    const averageMonthlySessions = Math.round(totalSessions / 3);

    console.log(`📊 Sessions (90d total): ${totalSessions}, Average monthly: ${averageMonthlySessions}`);
    return averageMonthlySessions;
  } catch (error) {
    console.error('Error fetching monthly sessions:', error);
    return null;
  }
}

/**
 * Fetches session data with time series breakdown (for analytics display)
 * 
 * @param admin - The authenticated admin GraphQL client from Shopify
 * @param days - Number of days to fetch (default 30)
 * @returns Array of daily session counts, or null if unable to fetch
 */
export async function getSessionsTimeSeries(
  admin: { graphql: (query: string) => Promise<Response> },
  days: number = 30
): Promise<Array<{ date: string; sessions: number }> | null> {
  try {
    const query = `
      query GetSessionsTimeSeries {
        shopifyqlQuery(query: "FROM sessions SHOW sessions SINCE -${days}d TIMESERIES day") {
          tableData {
            columns {
              name
              dataType
            }
            rows
          }
          parseErrors {
            message
          }
        }
      }
    `;

    const response = await admin.graphql(query);
    const result = await response.json() as { data?: ShopifyQLResponse; errors?: Array<{ message: string }> };

    if (result.errors && result.errors.length > 0) {
      console.error('ShopifyQL GraphQL errors:', result.errors);
      return null;
    }

    const shopifyqlData = result.data?.shopifyqlQuery;

    if (shopifyqlData?.parseErrors && shopifyqlData.parseErrors.length > 0) {
      console.error('ShopifyQL parse errors:', shopifyqlData.parseErrors);
      return null;
    }

    const tableData = shopifyqlData?.tableData;
    if (!tableData || !tableData.rows) {
      return [];
    }

    // Find column indices
    const dayColumnIndex = tableData.columns.findIndex(
      (col) => col.name.toLowerCase() === 'day'
    );
    const sessionsColumnIndex = tableData.columns.findIndex(
      (col) => col.name.toLowerCase() === 'sessions'
    );

    if (dayColumnIndex === -1 || sessionsColumnIndex === -1) {
      console.error('Required columns not found in ShopifyQL response');
      return null;
    }

    // Map rows to data points
    return tableData.rows.map((row) => ({
      date: row[dayColumnIndex],
      sessions: parseInt(row[sessionsColumnIndex], 10) || 0,
    }));
  } catch (error) {
    console.error('Error fetching sessions time series:', error);
    return null;
  }
}
