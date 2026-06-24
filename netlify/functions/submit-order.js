exports.handler = async (event, context) => {
    // Enable CORS to allow the frontend form to speak with this function securely
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const body = JSON.parse(event.body);
        const { resellerName, bottleModel, bottleSize, quantity, priority, phone, email } = body;

        // ================= CONFIGURATION =================
        const ORDER_BOARD_ID = 5098823299; // Your Order Management Board ID
        const BOTTLE_DIRECTORY_BOARD_ID = 5098910552; // Your Bottle Directory Board ID
        const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN; // Loaded securely from Netlify Env

        // Exact Column IDs retrieved from Developer Mode
        const CONNECT_BOTTLE_COLUMN_ID = "board_relation_mm4gqv1j"; // Connect Board Column
        const QUANTITY_COLUMN_ID = "numeric_mm4f5emj";             // # Units Column
        const PRIORITY_COLUMN_ID = "priority";                     // Priority Column
        const PHONE_COLUMN_ID = "text_mm4kgz08";                   // Phone (Text) Column
        const EMAIL_COLUMN_ID = "text_mm4gc2z0";                   // Email (Text) Column
        const STATUS_COLUMN_ID = "project_status";                 // Order Status Column
        // =================================================

        const API_URL = "https://api.monday.com/v2";

        // Step A: Fetch all bottle items from the Bottle Directory to find a match
        const directoryQuery = `
            query {
                boards(ids: ${BOTTLE_DIRECTORY_BOARD_ID}) {
                    items_page(limit: 100) {
                        items {
                            id
                            name
                        }
                    }
                }
            }
        `;

        const directoryResponse = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': MONDAY_API_TOKEN,
                'API-Version': '2025-04' // Standard active API version
            },
            body: JSON.stringify({ query: directoryQuery })
        });

        const directoryData = await directoryResponse.json();

        if (!directoryData.data || !directoryData.data.boards || directoryData.data.boards.length === 0) {
            throw new Error("Could not fetch Bottle Directory. Please verify your Bottle Directory Board ID or API token.");
        }

        const bottleItems = directoryData.data.boards[0].items_page.items;

        // Step B: Match the frontend selection with the directory item name
        // e.g., maps frontend selection "Aruba" + "0.75L" to Bottle Directory name "Aruba - 0.75L"
        const targetBottleName = `${bottleModel} - ${bottleSize}`;
        const matchedBottle = bottleItems.find(item => item.name.trim().toLowerCase() === targetBottleName.trim().toLowerCase());

        if (!matchedBottle) {
            throw new Error(`Could not find a bottle named "${targetBottleName}" in your Bottle Directory.`);
        }

        const matchedBottleId = matchedBottle.id; // The internal item ID needed for Connect Boards

        // Step C: Construct column values dynamically
        const colValsObj = {
            [CONNECT_BOTTLE_COLUMN_ID]: { "item_ids": [Number(matchedBottleId)] }, // Relates Connect Boards
            [QUANTITY_COLUMN_ID]: quantity,
            [PRIORITY_COLUMN_ID]: { "label": priority },
            [PHONE_COLUMN_ID]: phone, // Text column takes raw string
            [EMAIL_COLUMN_ID]: email, // Text column takes raw string
            [STATUS_COLUMN_ID]: { "label": "New Request" } // Sets label to "New Request"
        };

        const columnValues = JSON.stringify(colValsObj);

        // Step D: Create the new order item in your Order Management board
        const mutation = `
            mutation ($itemName: String!, $columnVals: JSON!) {
                create_item (
                    board_id: ${ORDER_BOARD_ID},
                    item_name: $itemName,
                    column_values: $columnVals
                ) {
                    id
                }
            }
        `;

        const variables = {
            itemName: resellerName,
            columnVals: columnValues
        };

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': MONDAY_API_TOKEN,
                'API-Version': '2025-04'
            },
            body: JSON.stringify({ query: mutation, variables })
        });

        const data = await response.json();

        // monday returns HTTP 200 even when the GraphQL mutation fails,
        // so check for an errors array and surface it as a real failure.
        if (data.errors || !data.data || !data.data.create_item) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: "monday.com rejected the order", details: data.errors || data })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(data)
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
