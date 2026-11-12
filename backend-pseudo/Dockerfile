FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY backend-pseudo/PseudoBackend.csproj backend-pseudo/
COPY backend-pseudo/Program.cs backend-pseudo/
COPY backend-pseudo/models backend-pseudo/models
RUN dotnet publish backend-pseudo/PseudoBackend.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "PseudoBackend.dll"]
