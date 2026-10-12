using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace HotelPms.Server.Infrastructure;

/// <summary>Para alanları JSON'da string taşındığı için OpenAPI şemasında da string (format: decimal) olarak tanımlanır.</summary>
public sealed class DecimalAsStringSchemaTransformer : IOpenApiSchemaTransformer
{
    public Task TransformAsync(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken cancellationToken)
    {
        var t = context.JsonTypeInfo.Type;
        if (t == typeof(decimal) || t == typeof(decimal?))
        {
            schema.Type = JsonSchemaType.String | (t == typeof(decimal?) ? JsonSchemaType.Null : 0);
            schema.Format = "decimal";
            schema.Pattern = null;
        }
        return Task.CompletedTask;
    }
}
