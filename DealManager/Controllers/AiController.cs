using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using DealManager.Models;
using DealManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DealManager.Controllers;

[ApiController]
[Route("api/ai")]
[Authorize]
public class AiController : ControllerBase
{
    private readonly AlphaVantageService _alpha;
    private readonly MarketstackService _marketstack;
    private readonly ILogger<AiController> _logger;
    private readonly TrendAnalyzer _trendAnalyzer;
    private readonly IRiskService _riskService;
    private readonly UsersService _usersService;
    private readonly AiChatHistoryService _history;
    private readonly DealsService _dealsService;
    private readonly StocksService _stocksService;
    private readonly GroqChatClient _groq;
    private const string PriceSourceHeader = "X-Price-Source";
    private const string PortfolioTicker = "__PORTFOLIO__";

    public AiController(
        AlphaVantageService alpha,
        MarketstackService marketstack,
        ILogger<AiController> logger,
        TrendAnalyzer trendAnalyzer,
        IRiskService riskService,
        UsersService usersService,
        AiChatHistoryService history,
        DealsService dealsService,
        StocksService stocksService,
        GroqChatClient groq)
    {
        _alpha = alpha;
        _marketstack = marketstack;
        _logger = logger;
        _trendAnalyzer = trendAnalyzer;
        _riskService = riskService;
        _usersService = usersService;
        _history = history;
        _dealsService = dealsService;
        _stocksService = stocksService;
        _groq = groq;
    }

    public sealed record StockChatRequest(
        string Ticker,
        string Message,
        string? StockId = null,
        decimal? StopLossPercent = null,
        decimal? EntryPrice = null,
        decimal? StopLossPrice = null,
        decimal? TakeProfitPrice = null);

    public sealed record PortfolioChatRequest(string Message);

    // AI response schema (strict JSON)
    private sealed class AiAdvice
    {
        [JsonPropertyName("summary")] public string? Summary { get; set; }
        [JsonPropertyName("action")] public string? Action { get; set; }
        [JsonPropertyName("why")] public List<string>? Why { get; set; }
        [JsonPropertyName("conditions")] public List<string>? Conditions { get; set; }
        [JsonPropertyName("buyLevels")] public List<decimal>? BuyLevels { get; set; }
        [JsonPropertyName("sellLevels")] public List<decimal>? SellLevels { get; set; }
        [JsonPropertyName("stop")] public AiStop? Stop { get; set; }
        [JsonPropertyName("add")] public AiAdd? Add { get; set; }
        [JsonPropertyName("riskNotes")] public List<string>? RiskNotes { get; set; }
        [JsonPropertyName("questions")] public List<string>? Questions { get; set; }
    }

    private sealed class AiEnvelope
    {
        [JsonPropertyName("assistantText")] public string? AssistantText { get; set; }
        [JsonPropertyName("policy")] public AiAdvice? Policy { get; set; }
    }

    private sealed class AiStop
    {
        [JsonPropertyName("recommended")] public decimal? Recommended { get; set; }
        [JsonPropertyName("why")] public string? Why { get; set; }
    }

    private sealed class AiAdd
    {
        [JsonPropertyName("maxShares")] public decimal? MaxShares { get; set; }
        [JsonPropertyName("stage1Shares")] public decimal? Stage1Shares { get; set; }
        [JsonPropertyName("stage2Shares")] public decimal? Stage2Shares { get; set; }
        [JsonPropertyName("note")] public string? Note { get; set; }
    }

    private static readonly JsonSerializerOptions JsonIn = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private static readonly JsonSerializerOptions JsonOut = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static string NormalizeAction(string? a)
    {
        var s = (a ?? "").Trim().ToLowerInvariant();
        return s switch
        {
            "buy" => "buy",
            "add" => "add",
            "trim" => "trim",
            "sell" => "sell",
            _ => "wait"
        };
    }

    private static bool TryParseDecimal(string? s, out decimal value)
    {
        value = 0m;
        if (string.IsNullOrWhiteSpace(s)) return false;
        var normalized = s.Trim().Replace(',', '.');
        return decimal.TryParse(normalized, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out value);
    }

    private static AiAdvice? TryParseAiAdvice(string content)
    {
        if (string.IsNullOrWhiteSpace(content)) return null;
        var s = content.Trim();

        // Strip markdown fences if present
        if (s.StartsWith("```", StringComparison.Ordinal))
        {
            s = System.Text.RegularExpressions.Regex.Replace(s, "^```[a-zA-Z0-9_-]*\\s*", "");
            s = System.Text.RegularExpressions.Regex.Replace(s, "```\\s*$", "");
            s = s.Trim();
        }

        try
        {
            return JsonSerializer.Deserialize<AiAdvice>(s, JsonIn);
        }
        catch
        {
            // Try to extract first JSON object
            var first = s.IndexOf('{');
            var last = s.LastIndexOf('}');
            if (first >= 0 && last > first)
            {
                var sub = s.Substring(first, last - first + 1);
                try { return JsonSerializer.Deserialize<AiAdvice>(sub, JsonIn); } catch { }
            }
            return null;
        }
    }

    private static AiEnvelope? TryParseAiEnvelope(string content)
    {
        if (string.IsNullOrWhiteSpace(content)) return null;
        var s = content.Trim();

        // Strip markdown fences if present
        if (s.StartsWith("```", StringComparison.Ordinal))
        {
            s = System.Text.RegularExpressions.Regex.Replace(s, "^```[a-zA-Z0-9_-]*\\s*", "");
            s = System.Text.RegularExpressions.Regex.Replace(s, "```\\s*$", "");
            s = s.Trim();
        }

        try
        {
            return JsonSerializer.Deserialize<AiEnvelope>(s, JsonIn);
        }
        catch
        {
            var first = s.IndexOf('{');
            var last = s.LastIndexOf('}');
            if (first >= 0 && last > first)
            {
                var sub = s.Substring(first, last - first + 1);
                try { return JsonSerializer.Deserialize<AiEnvelope>(sub, JsonIn); } catch { }
            }
            return null;
        }
    }

    private static string SerializeAdvice(AiAdvice advice) =>
        JsonSerializer.Serialize(advice, JsonOut);

    private static string SerializeEnvelope(AiEnvelope env) =>
        JsonSerializer.Serialize(env, JsonOut);

    private string GetUserId()
    {
        var userId =
            User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);

        if (string.IsNullOrWhiteSpace(userId))
            throw new InvalidOperationException("No user id in JWT");

        return userId;
    }

    [HttpGet("stock-chat/history")]
    public async Task<IActionResult> GetHistory(
        [FromQuery] string ticker,
        [FromQuery] string? stockId = null,
        [FromQuery] int limit = 100)
    {
        var t = (ticker ?? "").Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(t))
            return BadRequest("ticker is required");

        var userId = GetUserId();
        var messages = await _history.GetMessagesAsync(userId, t, stockId, limit);
        return Ok(new
        {
            ticker = t,
            stockId,
            messages = messages.Select(m => new { role = m.Role, content = m.Content, createdAtUtc = m.CreatedAtUtc })
        });
    }

    [HttpPost("stock-chat/clear")]
    public async Task<IActionResult> ClearHistory([FromQuery] string ticker, [FromQuery] string? stockId = null)
    {
        var t = (ticker ?? "").Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(t))
            return BadRequest("ticker is required");

        var userId = GetUserId();
        await _history.ClearAsync(userId, t, stockId);
        return NoContent();
    }

    [HttpGet("portfolio-chat/history")]
    public async Task<IActionResult> GetPortfolioHistory([FromQuery] int limit = 100)
    {
        var userId = GetUserId();
        var messages = await _history.GetMessagesAsync(userId, PortfolioTicker, null, limit);
        return Ok(new
        {
            ticker = PortfolioTicker,
            messages = messages.Select(m => new { role = m.Role, content = m.Content, createdAtUtc = m.CreatedAtUtc })
        });
    }

    [HttpPost("portfolio-chat/clear")]
    public async Task<IActionResult> ClearPortfolioHistory()
    {
        var userId = GetUserId();
        await _history.ClearAsync(userId, PortfolioTicker, null);
        return NoContent();
    }

    [HttpPost("portfolio-chat")]
    public async Task<IActionResult> PortfolioChat([FromBody] PortfolioChatRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Message))
            return BadRequest("Message is required");

        var userId = GetUserId();

        await _history.AppendAsync(
            userId,
            PortfolioTicker,
            null,
            new DealManager.Models.AiChatMessage { Role = "user", Content = req.Message });

        var deals = await _dealsService.GetByUserAsync(userId);
        var stocks = await _stocksService.GetAllForOwnerAsync(userId);

        var cash = await _usersService.GetPortfolioAsync(userId);
        var totalSum = await _usersService.GetTotalSumAsync(userId);
        var inShares = await _usersService.GetInSharesAsync(userId);
        var portfolioRiskPercent = await _riskService.CalculatePortfolioRiskPercentAsync(userId);
        var inSharesRiskPercent = await _riskService.CalculateInSharesRiskPercentAsync(userId);

        var openDeals = deals.Where(d => !d.Closed && !d.PlannedFuture).ToList();
        var plannedDeals = deals.Where(d => d.PlannedFuture && !d.Closed).ToList();
        var closedDeals = deals.Where(d => d.Closed).ToList();

        decimal ParseDecimalSafe(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return 0m;
            var normalized = s.Trim().Replace(',', '.');
            return decimal.TryParse(
                normalized,
                System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture,
                out var value)
                ? value
                : 0m;
        }

        decimal? AvgOrNull(List<decimal> values) =>
            values.Count == 0 ? null : values.Average();

        (decimal shares, decimal cost) SumStages(Deal d)
        {
            if (d.Amount_tobuy_stages == null || d.BuyPriceStages == null)
                return (0m, 0m);

            var count = Math.Min(d.Amount_tobuy_stages.Count, d.BuyPriceStages.Count);
            decimal shares = 0m;
            decimal cost = 0m;

            for (var i = 0; i < count; i++)
            {
                var stageShares = ParseDecimalSafe(d.Amount_tobuy_stages[i]);
                var stagePrice = ParseDecimalSafe(d.BuyPriceStages[i]);
                if (stageShares <= 0m || stagePrice <= 0m) continue;
                shares += stageShares;
                cost += stageShares * stagePrice;
            }

            return (shares, cost);
        }

        var plannedTotalSum = plannedDeals.Sum(d => ParseDecimalSafe(d.TotalSum));
        var plannedStopLossList = plannedDeals
            .Select(d => ParseDecimalSafe(d.StopLossPercent))
            .Where(v => v > 0m)
            .ToList();
        var plannedTakeProfitList = plannedDeals
            .Select(d => ParseDecimalSafe(d.TakeProfitPercent))
            .Where(v => v > 0m)
            .ToList();
        var plannedByTicker = plannedDeals
            .Where(d => !string.IsNullOrWhiteSpace(d.Stock))
            .GroupBy(d => d.Stock.Trim().ToUpperInvariant())
            .Select(g => new
            {
                ticker = g.Key,
                count = g.Count(),
                totalSum = g.Sum(x => ParseDecimalSafe(x.TotalSum))
            })
            .OrderByDescending(x => x.totalSum)
            .ToList();

        var plannedStageTotals = plannedDeals
            .Select(SumStages)
            .Aggregate((shares: 0m, cost: 0m), (acc, x) => (acc.shares + x.shares, acc.cost + x.cost));

        var plannedTopRisk = plannedDeals
            .Select(d =>
            {
                var total = ParseDecimalSafe(d.TotalSum);
                var sl = ParseDecimalSafe(d.StopLossPercent);
                var riskUsd = (sl > 0m && total > 0m) ? Math.Round(total * sl / 100m, 2) : 0m;
                return new { deal = d, total, sl, riskUsd };
            })
            .Where(x => x.riskUsd > 0m)
            .OrderByDescending(x => x.riskUsd)
            .Take(3)
            .Select(x => new
            {
                id = x.deal.Id,
                ticker = x.deal.Stock,
                totalSum = x.total,
                stopLossPercent = x.sl,
                riskUsd = x.riskUsd
            })
            .ToList();

        var openTotalSum = openDeals.Sum(d => ParseDecimalSafe(d.TotalSum));
        var openStopLossList = openDeals
            .Select(d => ParseDecimalSafe(d.StopLossPercent))
            .Where(v => v > 0m)
            .ToList();
        var openTakeProfitList = openDeals
            .Select(d => ParseDecimalSafe(d.TakeProfitPercent))
            .Where(v => v > 0m)
            .ToList();
        var openStageTotals = openDeals
            .Select(SumStages)
            .Aggregate((shares: 0m, cost: 0m), (acc, x) => (acc.shares + x.shares, acc.cost + x.cost));

        object MapDeal(Deal d) => new
        {
            id = d.Id,
            stock = d.Stock,
            date = d.Date,
            closed = d.Closed,
            planned_future = d.PlannedFuture,
            activatedAt = d.ActivatedAt,
            closedAt = d.ClosedAt,
            share_price = d.SharePrice,
            avg_entry = d.AvgEntry,
            stop_loss = d.StopLoss,
            stop_loss_prcnt = d.StopLossPercent,
            take_profit = d.TakeProfit,
            take_profit_prcnt = d.TakeProfitPercent,
            total_sum = d.TotalSum,
            amount_tobuy_stages = d.Amount_tobuy_stages,
            buy_price_stages = d.BuyPriceStages,
            notes = d.Notes,
            reward_to_risk = d.RewardToRisk
        };

        var context = new
        {
            userMessage = req.Message,
            portfolio = new
            {
                cash,
                totalSum,
                inShares,
                portfolioRiskPercent,
                inSharesRiskPercent
            },
            counts = new
            {
                openDeals = openDeals.Count,
                plannedDeals = plannedDeals.Count,
                closedDeals = closedDeals.Count,
                stocks = stocks.Count
            },
            plannedAggregates = new
            {
                totalSum = plannedTotalSum,
                avgStopLossPercent = AvgOrNull(plannedStopLossList),
                avgTakeProfitPercent = AvgOrNull(plannedTakeProfitList),
                byTicker = plannedByTicker,
                stages = new
                {
                    totalShares = plannedStageTotals.shares,
                    totalCost = plannedStageTotals.cost
                },
                topRisk = plannedTopRisk
            },
            openAggregates = new
            {
                totalSum = openTotalSum,
                avgStopLossPercent = AvgOrNull(openStopLossList),
                avgTakeProfitPercent = AvgOrNull(openTakeProfitList),
                stages = new
                {
                    totalShares = openStageTotals.shares,
                    totalCost = openStageTotals.cost
                }
            },
            deals = new
            {
                open = openDeals.Select(MapDeal).ToList(),
                planned = plannedDeals.Select(MapDeal).ToList(),
                closed = closedDeals.Select(MapDeal).ToList()
            },
            stocks = stocks.Select(s => new
            {
                id = s.Id,
                ticker = s.Ticker,
                desc = s.Desc,
                sp500Member = s.Sp500Member,
                betaVolatility = s.BetaVolatility,
                regular_volume = s.RegularVolume,
                sync_sp500 = s.SyncSp500,
                atr = s.Atr,
                order = s.Order
            }).ToList()
        };

        var systemPrompt =
@"You are a portfolio assistant focused on risk-aware guidance.
Return STRICT JSON only (no markdown, no extra text).
Schema:
{
  ""assistantText"": string,
  ""policy"": {
    ""summary"": string,
    ""action"": ""wait""|""buy""|""add""|""trim""|""sell"",
    ""why"": string[],
    ""conditions"": string[],
    ""buyLevels"": number[],
    ""sellLevels"": number[],
    ""stop"": { ""recommended"": number|null, ""why"": string },
    ""add"": { ""maxShares"": number|null, ""stage1Shares"": number|null, ""stage2Shares"": number|null, ""note"": string },
    ""riskNotes"": string[],
    ""questions"": string[]
  }
}
Rules:
1) Use ONLY the provided context values; never invent prices or positions.
2) If data is missing to answer, add it to questions.
3) Be conservative and focus on risk notes and conditions.
4) If plannedAggregates.topRisk is provided, mention it when asked about planned deal risk.
";

        var userContent = JsonSerializer.Serialize(context);
        string llm;
        try
        {
            llm = await _groq.ChatAsync(systemPrompt, userContent, ct);
        }
        catch (Exception ex)
        {
            var errMsg = $"AI request failed: {ex.Message}";
            await _history.AppendAsync(
                userId,
                PortfolioTicker,
                null,
                new DealManager.Models.AiChatMessage { Role = "assistant", Content = errMsg });
            throw;
        }

        var env = TryParseAiEnvelope(llm);
        var advice = env?.Policy ?? TryParseAiAdvice(llm) ?? new AiAdvice
        {
            Summary = "AI response was not valid JSON. Please retry.",
            Action = "wait",
            RiskNotes = new List<string> { "Model did not return parsable JSON." },
            Questions = new List<string> { "Try again, or ask a simpler question." }
        };

        advice.Action = NormalizeAction(advice.Action);
        advice.Why ??= new List<string>();
        advice.Conditions ??= new List<string>();
        advice.RiskNotes ??= new List<string>();
        advice.Questions ??= new List<string>();
        advice.Stop ??= new AiStop();
        advice.Add ??= new AiAdd();
        advice.BuyLevels ??= new List<decimal>();
        advice.SellLevels ??= new List<decimal>();

        var assistantText = (env?.AssistantText ?? "").Trim();
        if (string.IsNullOrWhiteSpace(assistantText))
        {
            var s = (advice.Summary ?? "").Trim();
            assistantText = string.IsNullOrWhiteSpace(s)
                ? $"Action: {advice.Action}"
                : s;
        }

        var enforcedEnvelopeJson = SerializeEnvelope(new AiEnvelope
        {
            AssistantText = assistantText,
            Policy = advice
        });

        await _history.AppendAsync(
            userId,
            PortfolioTicker,
            null,
            new DealManager.Models.AiChatMessage { Role = "assistant", Content = enforcedEnvelopeJson });

        return Ok(new
        {
            responseJson = enforcedEnvelopeJson
        });
    }

    [HttpPost("stock-chat")]
    public async Task<IActionResult> StockChat([FromBody] StockChatRequest req, CancellationToken ct)
    {
        var ticker = (req.Ticker ?? "").Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(ticker))
            return BadRequest("Ticker is required");

        if (string.IsNullOrWhiteSpace(req.Message))
            return BadRequest("Message is required");

        var userId = GetUserId();

        // If StockId is a dealId (we set it so in UI), auto-load deal context when missing
        decimal? entryPrice = req.EntryPrice;
        decimal? stopLossPrice = req.StopLossPrice;
        decimal? takeProfitPrice = req.TakeProfitPrice;
        decimal? stopLossPercent = req.StopLossPercent;
        object? dealCard = null;
        object? stockCard = null;

        if (!string.IsNullOrWhiteSpace(req.StockId))
        {
            try
            {
                var deal = await _dealsService.GetAsync(req.StockId, userId);
                if (deal != null)
                {
                    if (!entryPrice.HasValue && TryParseDecimal(deal.SharePrice, out var ep)) entryPrice = ep;
                    if (!stopLossPrice.HasValue && TryParseDecimal(deal.StopLoss, out var slp)) stopLossPrice = slp;
                    if (!takeProfitPrice.HasValue && TryParseDecimal(deal.TakeProfit, out var tpp)) takeProfitPrice = tpp;
                    if (!stopLossPercent.HasValue && TryParseDecimal(deal.StopLossPercent, out var slPct)) stopLossPercent = slPct;

                    // Prefer ticker from deal if it matches request (or request was empty)
                    if (!string.IsNullOrWhiteSpace(deal.Stock))
                        ticker = deal.Stock.Trim().ToUpperInvariant();

                    // Deal card context: include all fields used on UI, exclude commented-out UI fields.
                    // Explicit allowlist to avoid leaking unused/hidden fields.
                    dealCard = new
                    {
                        id = deal.Id,
                        closed = deal.Closed,
                        closedAt = deal.ClosedAt,
                        planned_future = deal.PlannedFuture,
                        activatedAt = deal.ActivatedAt,
                        date = deal.Date,
                        stock = deal.Stock,
                        share_price = deal.SharePrice,
                        amount_tobuy_stages = deal.Amount_tobuy_stages,
                        take_profit = deal.TakeProfit,
                        take_profit_prcnt = deal.TakeProfitPercent,
                        stop_loss = deal.StopLoss,
                        stop_loss_prcnt = deal.StopLossPercent,
                        total_sum = deal.TotalSum,
                        sp500_up = deal.Sp500Up,
                        price_range_pos = deal.PriceRangePos,
                        support_price = deal.SupportPrice,
                        o_price = deal.OPrice,
                        h_price = deal.HPrice,
                        monthly_dir = deal.MonthlyDir,
                        weekly_dir = deal.WeeklyDir,
                        buy_green_sell_red = deal.BuyGreenSellRed,
                        notes = deal.Notes,
                        reward_to_risk = deal.RewardToRisk
                    };
                }
            }
            catch
            {
                // ignore
            }
        }

        // Persist user message first
        await _history.AppendAsync(
            userId,
            ticker,
            req.StockId,
            new DealManager.Models.AiChatMessage { Role = "user", Content = req.Message });

        // --- Market data ---
        var (weekly, weeklySource) = await GetWeeklyWithSourceAsync(ticker);
        if (weekly.Count == 0)
            return NotFound("No data for this ticker");

        var (quote, quoteSource) = await GetQuoteWithSourceAsync(ticker);
        SetPriceSourceHeader(CombineSources(weeklySource, quoteSource));
        var price = quote?.Price ?? weekly[^1].Close;

        // --- Indicators ---
        var atr = AtrCalculator.CalculateAtr(weekly, period: 14);

        var weeklyTrend = _trendAnalyzer.DetectTrendByLowsForWeeks(weekly, weeks: 2).ToString();
        var monthlyTrend = _trendAnalyzer.DetectTrendByLowsForMonthsFromWeeks(weekly, weeks: 3).ToString();

        // --- Rules context ---
        // Stop always under previous week's low with buffer
        var prevWeekLow = weekly[^1].Low;
        var buffer = Math.Max(atr.AtrValue * 0.10m, price * 0.002m); // max(0.1*ATR, 0.2% price)
        var recommendedStop = Math.Round(prevWeekLow - buffer, 2);

        // Pullback rule (variant 1):
        // "Current price has retraced 50% of last week's growth (weekly Open->Close)."
        // Applies only if last week is green (Close > Open).
        var lastWeekOpen = weekly[^1].Open;
        var lastWeekClose = weekly[^1].Close;
        var lastWeekGrowth = lastWeekClose - lastWeekOpen;
        var pullbackMidpoint = (lastWeekOpen + lastWeekClose) / 2m;
        var pullbackOk = lastWeekGrowth > 0m && price <= pullbackMidpoint;

        var levels = _trendAnalyzer.DetectSupportResistanceLevels(
            weekly,
            minHighTouches: 1,
            minLowTouches: 1,
            minTotalTouches: 2,
            maxLevels: 6);

        var moveMetrics = MoveAnalyzer.CalculateNormalizedMoveMetricsForPeriod(
            weekly,
            lookbackBars: 52,
            flatThresholdPct: 0.001);
        var moveScore = MoveScoreCombiner.Combine(moveMetrics);

        object? betaBlock = null;
        try
        {
            // Optional: beta/correlation vs SPY (may fail if SPY not present / API limits)
            var assetCandles = BetaService.ToWeeklyCandles(weekly);
            var (spyWeekly, spySource) = await GetWeeklyWithSourceAsync("SPY");
            SetPriceSourceHeader(CombineSources(weeklySource, spySource, quoteSource));
            if (spyWeekly.Count > 0)
            {
                var spyCandles = BetaService.ToWeeklyCandles(spyWeekly);
                var beta = BetaService.CalculateBetaAndCorrelation(assetCandles, spyCandles);
                int volCat;
                try { volCat = VolatilityCategory.FromBeta(beta.Beta); }
                catch { volCat = 0; }

                betaBlock = new
                {
                    beta = beta.Beta,
                    correlation = beta.Correlation,
                    volatilityCategory = volCat,
                    pointsUsed = beta.PointsUsed
                };
            }
        }
        catch
        {
            betaBlock = null;
        }

        // --- Portfolio / risk ---
        var cash = await _usersService.GetPortfolioAsync(userId);
        var totalSum = await _usersService.GetTotalSumAsync(userId);
        var inShares = await _usersService.GetInSharesAsync(userId);
        var portfolioRiskPercent = await _riskService.CalculatePortfolioRiskPercentAsync(userId);
        var inSharesRiskPercent = await _riskService.CalculateInSharesRiskPercentAsync(userId);

        // Stock card context (Mongo): include all fields from the stock list UI (not computed market metrics).
        try
        {
            var stock = await _stocksService.GetByTickerAsync(userId, ticker);
            if (stock != null)
            {
                stockCard = new
                {
                    id = stock.Id,
                    ticker = stock.Ticker,
                    desc = stock.Desc,
                    sp500Member = stock.Sp500Member,
                    betaVolatility = stock.BetaVolatility,
                    regular_volume = stock.RegularVolume,
                    sync_sp500 = stock.SyncSp500,
                    atr = stock.Atr,
                    order = stock.Order
                };
            }
        }
        catch
        {
            stockCard = null;
        }

        DealLimitResult? limits = null;
        if (stopLossPercent.HasValue && stopLossPercent.Value > 0)
        {
            limits = await _riskService.CalculateDealLimitsAsync(userId, stopLossPercent.Value);
        }

        decimal SharesFromUsd(decimal usd) => price > 0 ? Math.Floor(usd / price) : 0;

        var context = new
        {
            ticker,
            price,
            userMessage = req.Message,
            trade = new
            {
                entryPrice,
                stopLossPrice,
                takeProfitPrice,
                stopLossPercent
            },
            portfolio = new
            {
                cash,
                totalSum,
                inShares,
                portfolioRiskPercent,
                inSharesRiskPercent
            },
            atr = new
            {
                value = atr.AtrValue,
                percent = atr.AtrPercent,
                period = atr.Period,
                latestClose = atr.LatestClose
            },
            rules = new
            {
                noAverageDown = true,
                addOnlyOnPullback = true,
                pullbackDefinition = new
                {
                    method = "lastWeekOpenClose50pct",
                    lastWeekOpen,
                    lastWeekClose,
                    lastWeekGrowth,
                    pullbackMidpoint,
                    pullbackOk
                },
                stopRule = new { prevWeekLow, buffer, recommendedStop, description = "Stop = prevWeekLow - buffer" },
                portfolioRiskNeverExceed = true
            },
            dealCard,
            stockCard,
            trends = new { weekly = weeklyTrend, monthly = monthlyTrend },
            supportResistance = levels.Select(l => new
            {
                level = l.Level,
                lowBound = l.LowBound,
                highBound = l.HighBound,
                touches = l.TotalTouches,
                score = l.Score,
                firstTouch = l.FirstTouch,
                lastTouch = l.LastTouch
            }).ToList(),
            movement = new
            {
                direction = moveMetrics.Direction,
                returnPct = moveMetrics.ReturnPct,
                speedPct = moveMetrics.SpeedPct,
                strengthPct = moveMetrics.StrengthPct,
                easeOfMovePct = moveMetrics.EaseOfMovePct,
                scoreMagnitudePct = moveScore.MagnitudePct,
                scoreSignedPct = moveScore.SignedPct
            },
            beta = betaBlock,
            limits = limits == null ? null : new
            {
                limits.Allowed,
                limits.MaxPosition,
                limits.MaxStage1,
                limits.RecommendedStage1,
                limits.RecommendedStage2,
                limits.AddedRiskPercent,
                limits.SingleStageMax,
                derived = new
                {
                    maxShares = SharesFromUsd(limits.MaxPosition),
                    stage1Shares = SharesFromUsd(limits.RecommendedStage1),
                    stage2Shares = SharesFromUsd(limits.RecommendedStage2),
                    singleStageMaxShares = SharesFromUsd(limits.SingleStageMax)
                }
            }
        };

        var systemPrompt =
@"You are a trading assistant focused on risk management.
Return STRICT JSON only (no markdown, no extra text).
Schema:
{
  ""assistantText"": string,
  ""policy"": {
    ""summary"": string,
    ""action"": ""wait""|""buy""|""add""|""trim""|""sell"",
    ""why"": string[],
    ""conditions"": string[],
    ""buyLevels"": number[],
    ""sellLevels"": number[],
    ""stop"": { ""recommended"": number|null, ""why"": string },
    ""add"": { ""maxShares"": number|null, ""stage1Shares"": number|null, ""stage2Shares"": number|null, ""note"": string },
    ""riskNotes"": string[],
    ""questions"": string[]
  }
}

Hard rules (must follow):
1) Never average down: do NOT recommend add if current price < entry price.
2) Add only on pullback: do NOT recommend add unless rules.pullbackDefinition.pullbackOk = true.
3) Stop rule: recommended stop MUST be rules.stopRule.recommendedStop (or more conservative). Always explain why.
4) Risk rule: if limits.allowed=false OR limits missing -> action cannot be buy/add.
5) If you recommend add, it must be compatible with break-even: stop must be >= entry price. If impossible under stop rule, do not add.

Use ONLY the provided context numbers; if something is missing, ask in questions.
Be conservative.";

        var userContent = JsonSerializer.Serialize(context);
        string llm;
        try
        {
            llm = await _groq.ChatAsync(systemPrompt, userContent, ct);
        }
        catch (Exception ex)
        {
            // Store an error response too (so chat isn't "stuck")
            var errMsg = $"AI request failed: {ex.Message}";
            await _history.AppendAsync(
                userId,
                ticker,
                req.StockId,
                new DealManager.Models.AiChatMessage { Role = "assistant", Content = errMsg });
            throw;
        }

        // Server-side enforcement of hard rules
        var env = TryParseAiEnvelope(llm);
        var advice = env?.Policy ?? TryParseAiAdvice(llm) ?? new AiAdvice
        {
            Summary = "AI response was not valid JSON. Please retry.",
            Action = "wait",
            RiskNotes = new List<string> { "Model did not return parsable JSON." },
            Questions = new List<string> { "Try again, or ask a simpler question." },
            Stop = new AiStop { Recommended = recommendedStop, Why = "Rule: stop under previous week's low." }
        };

        advice.Action = NormalizeAction(advice.Action);
        advice.Why ??= new List<string>();
        advice.Conditions ??= new List<string>();
        advice.RiskNotes ??= new List<string>();
        advice.Questions ??= new List<string>();
        advice.Stop ??= new AiStop();
        advice.Add ??= new AiAdd();

        // Always enforce stop rule
        advice.Stop.Recommended = recommendedStop;
        advice.Stop.Why = string.IsNullOrWhiteSpace(advice.Stop.Why)
            ? $"Stop is set under previous week's low ({prevWeekLow}) with buffer ({buffer:F4})."
            : advice.Stop.Why;

        var allowRisk = limits != null && limits.Allowed;

        // Missing limits => cannot buy/add
        if (limits == null)
        {
            if (advice.Action is "buy" or "add")
                advice.Action = "wait";
            advice.Conditions.Add("Provide Stop loss % (stop_loss_prcnt) so position sizing can be calculated.");
            advice.Questions.Add("Provide Stop loss % (stop_loss_prcnt) so position sizing can be calculated safely.");
            advice.Add = new AiAdd { Note = "Sizing disabled: stopLossPercent missing." };
        }
        else if (!allowRisk)
        {
            if (advice.Action is "buy" or "add")
                advice.Action = "wait";
            advice.Conditions.Add("Portfolio risk must be below limit: limits.allowed must be true.");
            advice.RiskNotes.Add("Risk rule: portfolio risk limit would be exceeded (limits.allowed=false).");
            advice.Add = new AiAdd { Note = "Sizing disabled: limits.allowed=false." };
        }

        // Never average down: block add when price < entry
        if (advice.Action == "add")
        {
            if (!entryPrice.HasValue || entryPrice.Value <= 0)
            {
                advice.Action = "wait";
                advice.Conditions.Add("Entry price must be set (share_price) to enforce 'never average down' and breakeven stop rule.");
                advice.Questions.Add("What is your entry price? (Needed to enforce 'never average down' and breakeven stop rule.)");
                advice.RiskNotes.Add("Add blocked: entry price missing.");
            }
            else if (price < entryPrice.Value)
            {
                advice.Action = "wait";
                advice.Conditions.Add($"Never average down: wait until price >= entry ({entryPrice.Value:F2}).");
                advice.RiskNotes.Add($"Add blocked: never average down (price {price:F2} < entry {entryPrice.Value:F2}).");
            }
        }

        // Add only on pullback (and conservative for buy/add)
        if (advice.Action is "buy" or "add")
        {
            if (!pullbackOk)
            {
                advice.Action = "wait";
                if (lastWeekGrowth <= 0m)
                {
                    advice.Conditions.Add("Pullback rule applies only if last week is green (weekly Close > Open).");
                    advice.RiskNotes.Add("Add/buy blocked: pullback rule requires last week to be green (Close > Open).");
                }
                else
                {
                    advice.Conditions.Add($"Wait for price <= {pullbackMidpoint:F2} (50% retracement of last week's Open->Close move).");
                    advice.RiskNotes.Add($"Add/buy blocked: no 50% pullback from last week's growth (price {price:F2} > midpoint {pullbackMidpoint:F2}).");
                }
            }
        }

        // Break-even requirement for add
        if (advice.Action == "add" && entryPrice.HasValue && entryPrice.Value > 0)
        {
            if (recommendedStop < entryPrice.Value)
            {
                advice.Action = "wait";
                advice.Conditions.Add($"For add: weekly-low stop must be >= entry. Currently stop {recommendedStop:F2} < entry {entryPrice.Value:F2}.");
                advice.RiskNotes.Add($"Add blocked: cannot keep stop at/above breakeven while following weekly-low stop rule (stop {recommendedStop:F2} < entry {entryPrice.Value:F2}).");
            }
        }

        // Clamp sizing to computed limits (shares are derived from USD caps)
        if (limits != null)
        {
            var maxShares = SharesFromUsd(limits.MaxPosition);
            var stage1Shares = SharesFromUsd(limits.RecommendedStage1);
            var stage2Shares = SharesFromUsd(limits.RecommendedStage2);
            var singleStageMaxShares = SharesFromUsd(limits.SingleStageMax);

            // Provide sizing plan when safe to compute, even if action is 'wait'.
            // Execution still gated by Conditions and Hard rules.
            if (allowRisk)
            {
                advice.Add ??= new AiAdd();
                advice.Add.MaxShares = maxShares;
                advice.Add.Stage1Shares = Math.Min(stage1Shares, singleStageMaxShares);
                advice.Add.Stage2Shares = stage2Shares;

                var baseNote = $"Sizing plan respects risk limits. Single-stage max shares: {singleStageMaxShares}.";
                if (advice.Action == "wait")
                {
                    advice.Add.Note = string.IsNullOrWhiteSpace(advice.Add.Note)
                        ? baseNote + " (Plan only: execute only when conditions are met.)"
                        : advice.Add.Note;
                }
                else
                {
                    advice.Add.Note = string.IsNullOrWhiteSpace(advice.Add.Note)
                        ? baseNote
                        : advice.Add.Note;
                }
            }
            else
            {
                // For non-buy/add actions, don't force sizing fields
                advice.Add = advice.Add ?? new AiAdd();
                advice.Add.MaxShares = null;
                advice.Add.Stage1Shares = null;
                advice.Add.Stage2Shares = null;
            }
        }

        // Provide default planned levels if model didn't give them (helps "when to add" questions)
        advice.BuyLevels ??= new List<decimal>();
        advice.SellLevels ??= new List<decimal>();
        if (lastWeekGrowth > 0m && advice.BuyLevels.Count == 0)
        {
            advice.BuyLevels.Add(Math.Round(pullbackMidpoint, 2));
        }
        if (advice.BuyLevels.Count > 0)
            advice.BuyLevels = advice.BuyLevels.Distinct().OrderBy(x => x).ToList();

        // If model didn't provide assistantText, create one from policy
        var assistantText = (env?.AssistantText ?? "").Trim();
        if (string.IsNullOrWhiteSpace(assistantText))
        {
            var s = (advice.Summary ?? "").Trim();
            assistantText = string.IsNullOrWhiteSpace(s)
                ? $"Action: {advice.Action}"
                : s;
        }

        // Ensure assistant text is consistent with enforced action
        if (advice.Action == "wait")
        {
            // Add a short note if not already present
            if (!assistantText.Contains("wait", StringComparison.OrdinalIgnoreCase) &&
                !assistantText.Contains("ждать", StringComparison.OrdinalIgnoreCase))
            {
                assistantText = assistantText + "\n\n(По правилам сейчас: wait. См. Conditions.)";
            }
        }

        var enforcedEnvelopeJson = SerializeEnvelope(new AiEnvelope
        {
            AssistantText = assistantText,
            Policy = advice
        });

        await _history.AppendAsync(
            userId,
            ticker,
            req.StockId,
            new DealManager.Models.AiChatMessage { Role = "assistant", Content = enforcedEnvelopeJson });

        return Ok(new
        {
            ticker,
            responseJson = enforcedEnvelopeJson
        });
    }

    private async Task<(IReadOnlyList<PricePoint> Data, string Source)> GetWeeklyWithSourceAsync(string ticker)
    {
        try
        {
            var data = await _alpha.GetWeeklyAsync(ticker);
            return (data, "alpha");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Alpha Vantage failed for {Ticker}. Falling back to Marketstack.", ticker);
            var data = await _marketstack.GetWeeklyAsync(ticker, yearsBack: 2);
            return (data, "marketstack");
        }
    }

    private async Task<(AlphaVantageService.QuoteSnapshot? Quote, string Source)> GetQuoteWithSourceAsync(string ticker)
    {
        try
        {
            var quote = await _alpha.GetCurrentQuoteAsync(ticker);
            return (quote, "alpha");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Alpha Vantage failed for {Ticker} (quote). Falling back to Marketstack.", ticker);
            var quote = await _marketstack.GetCurrentQuoteAsync(ticker);
            var snapshot = quote == null ? null : new AlphaVantageService.QuoteSnapshot(quote.Price, quote.LastUpdatedUtc);
            return (snapshot, "marketstack");
        }
    }

    private void SetPriceSourceHeader(string source)
    {
        if (!string.IsNullOrWhiteSpace(source))
        {
            Response.Headers[PriceSourceHeader] = source;
        }
    }

    private static string CombineSources(params string[] sources)
    {
        if (sources == null || sources.Length == 0)
            return "unknown";

        var distinct = new HashSet<string>(sources.Where(s => !string.IsNullOrWhiteSpace(s)));
        return distinct.Count == 1 ? distinct.First() : "mixed";
    }
}


