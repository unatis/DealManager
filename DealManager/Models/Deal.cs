using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System.Text.Json.Serialization;

namespace DealManager.Models
{
    [BsonIgnoreExtraElements]   // на всякий случай игнорируем лишние поля
    public class Deal
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        [JsonPropertyName("id")]
        public string? Id { get; set; }

        [BsonRepresentation(BsonType.ObjectId)]
        [JsonIgnore]
        public string? UserId { get; set; }

        [JsonPropertyName("ownerId")]
        public string OwnerId { get; set; } = "";

        [JsonPropertyName("closed")]
        public bool Closed { get; set; }

        [JsonPropertyName("closedAt")]
        public DateTime? ClosedAt { get; set; }

        [JsonPropertyName("date")]
        public string Date { get; set; } = "";

        [JsonPropertyName("stock")]
        public string Stock { get; set; } = "";
             

        [JsonPropertyName("fear_too_late")]
        public string? FearTooLate { get; set; }

        [JsonPropertyName("get_even")]
        public string? GetEven { get; set; }

        [JsonPropertyName("from_others")]
        public string? FromOthers { get; set; }

        [JsonPropertyName("mistake_action")]
        public string? MistakeAction { get; set; }

        [JsonPropertyName("share_price")]
        public string? SharePrice { get; set; }

        [JsonPropertyName("amount_tobuy_stage_1")]
        public string? Amount_tobuy_stage_1 { get; set; }

        [JsonPropertyName("amount_tobuy_stage_2")]
        public string? Amount_tobuy_stage_2 { get; set; }

        [JsonPropertyName("amount_tobuy_stage_3")]
        public string? Amount_tobuy_stage_3 { get; set; }

        [JsonPropertyName("take_profit")]
        public string? TakeProfit { get; set; }

        [JsonPropertyName("take_profit_prcnt")]
        public string? TakeProfitPercent { get; set; }

        [JsonPropertyName("stop_loss_prcnt")]
        public string? StopLossPercent { get; set; }

        [JsonPropertyName("stop_loss")]
        public string? StopLoss { get; set; }

        [JsonPropertyName("amount_tobuy")]
        public string? AmountToBuy { get; set; }

        [JsonPropertyName("sp500_up")]
        public string? Sp500Up { get; set; }
               
        [JsonPropertyName("reversal")]
        public string? Reversal { get; set; }

        [JsonPropertyName("flatpattern")]
        public string? FlatPattern { get; set; }

        [JsonPropertyName("price_range_pos")]
        public string? PriceRangePos { get; set; }

        [JsonPropertyName("support_price")]
        public string? SupportPrice { get; set; }


        [JsonPropertyName("o_price")]
        public string? OPrice { get; set; }


        [JsonPropertyName("o_price")]
        public string? HPrice { get; set; }


        [JsonPropertyName("resist_price")]
        public string? ResistancePrice { get; set; }

        [JsonPropertyName("timeframe")]
        public string? Timeframe { get; set; }

        [JsonPropertyName("monthly_dir")]
        public string? MonthlyDir { get; set; }

        [JsonPropertyName("weekly_dir")]
        public string? WeeklyDir { get; set; }

       
        [JsonPropertyName("correction_trand")]
        public string? CorrectionTrend { get; set; }

        [JsonPropertyName("counter_trend")]
        public string? CounterTrend { get; set; }
        
        [JsonPropertyName("green_candle")]
        public string? GreenCandle { get; set; }

        [JsonPropertyName("flat_before_up")]
        public string? FlatBeforeUp { get; set; }

        [JsonPropertyName("flat_before_down")]
        public string? FlatBeforeDown { get; set; }

        [JsonPropertyName("green_eats_red")]
        public string? GreenEatsRed { get; set; }

        [JsonPropertyName("notes")]
        public string? Notes { get; set; }

        [JsonPropertyName("green_candle_higher")]
        public string? GreenCandleHigher { get; set; }

        
    }
}
