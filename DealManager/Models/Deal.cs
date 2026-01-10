using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System.Text.Json.Serialization;
using DealManager.Services;

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

        /// <summary>
        /// Признак запланированной сделки (ещё не активирована в портфеле).
        /// </summary>
        [JsonPropertyName("planned_future")]
        public bool PlannedFuture { get; set; } = false;

        /// <summary>
        /// Время первой активации сделки (перевод из planned в реальную).
        /// </summary>
        [JsonPropertyName("activatedAt")]
        public DateTime? ActivatedAt { get; set; }

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

        // If true, SharePrice was manually set by user and should not be auto-overwritten by quote.
        [JsonPropertyName("share_price_manual")]
        public bool SharePriceManual { get; set; } = false;

        [JsonPropertyName("amount_tobuy_stage_1")]
        public string? Amount_tobuy_stage_1 { get; set; }

        [JsonPropertyName("amount_tobuy_stage_2")]
        public string? Amount_tobuy_stage_2 { get; set; }

        /// <summary>
        /// Новый формат: список стадий покупки (кол-во акций на каждой стадии).
        /// </summary>
        [JsonPropertyName("amount_tobuy_stages")]
        public List<string>? Amount_tobuy_stages { get; set; }

        [JsonPropertyName("buy_price_stages")]
        public List<string>? BuyPriceStages { get; set; }

        [JsonPropertyName("take_profit")]
        public string? TakeProfit { get; set; }

        [JsonPropertyName("take_profit_prcnt")]
        public string? TakeProfitPercent { get; set; }

        [JsonPropertyName("stop_loss_prcnt")]
        public string? StopLossPercent { get; set; }

        [JsonPropertyName("stop_loss")]
        public string? StopLoss { get; set; }

        [JsonPropertyName("total_sum")]
        public string? TotalSum { get; set; }

        [JsonPropertyName("close_price")]
        public string? ClosePrice { get; set; }

        [JsonPropertyName("sp500_up")]
        public string? Sp500Up { get; set; }
               
        [JsonPropertyName("reversal")]
        public string? Reversal { get; set; }

        [JsonPropertyName("price_range_pos")]
        public string? PriceRangePos { get; set; }

        [JsonPropertyName("support_price")]
        public string? SupportPrice { get; set; }


        [JsonPropertyName("o_price")]
        public string? OPrice { get; set; }


        [JsonPropertyName("h_price")]
        public string? HPrice { get; set; }


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

        [JsonPropertyName("buy_green_sell_red")]
        public string? BuyGreenSellRed { get; set; }
        

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

        [JsonIgnore]
        public double? RewardToRiskRatio
        {
            get
            {
                if (string.IsNullOrWhiteSpace(SharePrice) || 
                    string.IsNullOrWhiteSpace(StopLoss) || 
                    string.IsNullOrWhiteSpace(TakeProfit))
                    return null;

                if (!double.TryParse(SharePrice, out var entry) ||
                    !double.TryParse(StopLoss, out var stopLossValue) ||
                    !double.TryParse(TakeProfit, out var takeProfitValue))
                    return null;

                return DealsService.CalculateRewardToRisk(entry, stopLossValue, takeProfitValue);
            }
        }

        [JsonPropertyName("reward_to_risk")]
        public string? RewardToRisk => RewardToRiskRatio.HasValue && RewardToRiskRatio.Value > 0
            ? $"1:{RewardToRiskRatio.Value:F1}" 
            : null;
        
    }
}
