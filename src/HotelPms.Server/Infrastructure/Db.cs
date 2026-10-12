using System.Data;
using Dapper;
using Npgsql;

namespace HotelPms.Server.Infrastructure;

public sealed class Db(NpgsqlDataSource dataSource)
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public async Task<NpgsqlConnection> OpenAsync(CancellationToken ct = default) => await DataSource.OpenConnectionAsync(ct);

    public async Task<IReadOnlyList<T>> QueryAsync<T>(string sql, object? param = null, CancellationToken ct = default)
    {
        await using var c = await OpenAsync(ct);
        return (await c.QueryAsync<T>(new CommandDefinition(sql, param, cancellationToken: ct))).AsList();
    }

    public async Task<T?> QuerySingleOrDefaultAsync<T>(string sql, object? param = null, CancellationToken ct = default)
    {
        await using var c = await OpenAsync(ct);
        return await c.QuerySingleOrDefaultAsync<T>(new CommandDefinition(sql, param, cancellationToken: ct));
    }

    public async Task<T> ScalarAsync<T>(string sql, object? param = null, CancellationToken ct = default)
    {
        await using var c = await OpenAsync(ct);
        return (await c.ExecuteScalarAsync<T>(new CommandDefinition(sql, param, cancellationToken: ct)))!;
    }

    public static void ConfigureDapper()
    {
        DefaultTypeMap.MatchNamesWithUnderscores = true;
        SqlMapper.AddTypeHandler(new DateOnlyHandler());
        SqlMapper.AddTypeHandler(new NullableDateOnlyHandler());
        SqlMapper.AddTypeHandler(new TimeOnlyHandler());
        SqlMapper.AddTypeHandler(new JsonElementHandler());
        SqlMapper.AddTypeHandler(new NullableJsonElementHandler());
    }

    sealed class DateOnlyHandler : SqlMapper.TypeHandler<DateOnly>
    {
        public override void SetValue(IDbDataParameter p, DateOnly value) { p.DbType = DbType.Date; p.Value = value; }
        public override DateOnly Parse(object value) => value switch
        {
            DateOnly d => d,
            DateTime dt => DateOnly.FromDateTime(dt),
            _ => DateOnly.Parse(value.ToString()!),
        };
    }

    sealed class NullableDateOnlyHandler : SqlMapper.TypeHandler<DateOnly?>
    {
        public override void SetValue(IDbDataParameter p, DateOnly? value) { p.DbType = DbType.Date; p.Value = value.HasValue ? value.Value : DBNull.Value; }
        public override DateOnly? Parse(object value) => value switch
        {
            null or DBNull => null,
            DateOnly d => d,
            DateTime dt => DateOnly.FromDateTime(dt),
            _ => DateOnly.Parse(value.ToString()!),
        };
    }

    sealed class JsonElementHandler : SqlMapper.TypeHandler<System.Text.Json.JsonElement>
    {
        public override void SetValue(IDbDataParameter p, System.Text.Json.JsonElement value) { p.Value = value.GetRawText(); }
        public override System.Text.Json.JsonElement Parse(object value) => System.Text.Json.JsonDocument.Parse(value.ToString()!).RootElement.Clone();
    }

    sealed class NullableJsonElementHandler : SqlMapper.TypeHandler<System.Text.Json.JsonElement?>
    {
        public override void SetValue(IDbDataParameter p, System.Text.Json.JsonElement? value) { p.Value = value is { } v ? v.GetRawText() : DBNull.Value; }
        public override System.Text.Json.JsonElement? Parse(object value) => value is null or DBNull ? null : System.Text.Json.JsonDocument.Parse(value.ToString()!).RootElement.Clone();
    }

    sealed class TimeOnlyHandler : SqlMapper.TypeHandler<TimeOnly>
    {
        public override void SetValue(IDbDataParameter p, TimeOnly value) { p.DbType = DbType.Time; p.Value = value; }
        public override TimeOnly Parse(object value) => value switch
        {
            TimeOnly t => t,
            TimeSpan ts => TimeOnly.FromTimeSpan(ts),
            _ => TimeOnly.Parse(value.ToString()!),
        };
    }
}
